(function () {
  const $ = (id) => document.getElementById(id);
  const cfg = window.VOTE_CONFIG || {};
  const VOTES_KEY = "ingredient-scout.votes.v1";
  const SENT_KEY = "ingredient-scout.sent.v1";
  const BALLOT_KEY = "ingredient-scout.ballot.v1";
  const SYNC_KEY = "ingredient-scout.synced.v1";
  const BALLOT_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const POLL_MS = 25000;
  const SYNC_DELAY_MS = 900;

  const CHANNEL = {
    news: "新聞",
    exhibition: "展覽名錄",
    industry_report: "產業報導",
    supplier_site: "供應商網站",
    paper: "論文",
    patent: "專利",
    other: "其他"
  };
  const RELATION = {
    direct: "供應商直接對台",
    taiwan_agent: "台灣代理商",
    taiwan_distributor: "台灣經銷商",
    supplier_is_taiwan: "供應商在台灣",
    unknown: "關係未確認"
  };
  const TFDA = {
    listed_food_ingredient: "原料平臺有列（仍須看限制）",
    unconfirmed_not_for_food_use: "未確認安全性，尚不得使用",
    listed_food_additive: "食品添加物規格有列",
    not_found: "原料與添加物都未查到",
    lookup_blocked: "查詢尚未完成",
    needs_review: "待覆核",
    example_only: "範例檔，沒有查核結論"
  };
  const TRI = { yes: "有", no: "無", unknown: "未知" };
  const EVIDENCE = { in_vitro: "體外", cell: "細胞", animal: "動物", clinical: "臨床" };
  const TAB = { ingredient: "食品原料", additive: "食品添加物", history: "更新歷程" };

  const state = {
    catalog: window.INGREDIENT_CATALOG,
    date: "",
    votes: loadJson(localStorage, VOTES_KEY, {}),
    sending: false,
    ready: false,
    team: null,
    teamError: false,
    teamDate: "",
    teamGen: 0,
    syncing: false,
    syncQueued: false,
    queuedForce: false,
    queuedReason: "",
    syncReason: "auto",
    syncTimer: 0,
    lastSyncFailed: false,
    nextSyncAt: 0,
    syncBackoff: 0,
    memoryBallotId: "",
    pendingSyncDate: "",
    queuedDate: "",
    searchIndex: [],
    searchResults: [],
    searchActive: -1,
    searchOpen: false,
    searchExtra: 0,
    composing: false
  };

  function loadJson(storage, key, fallback) {
    try {
      const raw = storage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (error) {
      return fallback;
    }
  }

  function saveVotes() {
    try {
      localStorage.setItem(VOTES_KEY, JSON.stringify(state.votes));
    } catch (error) {
      announce("這台瀏覽器沒有留下本機記錄，請記得下載。");
    }
  }

  function httpsUrl(value) {
    try {
      const url = new URL(String(value || "").trim());
      const loopback = url.hostname === "localhost" || url.hostname === "127.0.0.1";
      // 公開收集端只接受 https。本機替身才允許 http，方便在自己的電腦對接試算表邏輯。
      if (url.protocol !== "https:" && !(loopback && url.protocol === "http:")) return "";
      url.hash = "";
      return url.href;
    } catch (error) {
      return "";
    }
  }

  function formspreeEndpoint() {
    const direct = httpsUrl(cfg.formspreeEndpoint);
    if (direct) return direct;
    if (cfg.submitMode === "formspree") return httpsUrl(cfg.submitEndpoint);
    return "";
  }

  function tallyEndpoint() {
    const direct = httpsUrl(cfg.tallyEndpoint) || httpsUrl(cfg.sheetEndpoint);
    if (direct) return direct;
    if (cfg.submitMode === "webhook") return httpsUrl(cfg.submitEndpoint);
    return "";
  }

  function createBallotId() {
    if (globalThis.crypto && typeof crypto.randomUUID === "function") return crypto.randomUUID();
    const bytes = new Uint8Array(16);
    if (globalThis.crypto && typeof crypto.getRandomValues === "function") crypto.getRandomValues(bytes);
    else {
      for (let i = 0; i < 16; i += 1) bytes[i] = Math.floor(Math.random() * 256);
    }
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, function (byte) {
      return byte.toString(16).padStart(2, "0");
    }).join("");
    return hex.slice(0, 8) + "-" + hex.slice(8, 12) + "-" + hex.slice(12, 16) + "-" + hex.slice(16, 20) + "-" + hex.slice(20);
  }

  function ballotId() {
    try {
      const existing = localStorage.getItem(BALLOT_KEY);
      if (existing && BALLOT_RE.test(existing)) return existing.toLowerCase();
      const created = createBallotId().toLowerCase();
      localStorage.setItem(BALLOT_KEY, created);
      return created;
    } catch (error) {
      if (!state.memoryBallotId) state.memoryBallotId = createBallotId().toLowerCase();
      return state.memoryBallotId;
    }
  }

  function syncRecord() {
    const raw = loadJson(localStorage, SYNC_KEY, {});
    return raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  }

  function channelSynced(date, channel, sig) {
    const row = syncRecord()[date];
    return !!row && typeof row === "object" && row[channel] === sig;
  }

  function markSynced(date, channel, sig) {
    try {
      const all = syncRecord();
      const row = all[date] && typeof all[date] === "object" ? all[date] : {};
      row[channel] = sig;
      all[date] = row;
      localStorage.setItem(SYNC_KEY, JSON.stringify(all));
    } catch (error) {
      announce("這台瀏覽器沒有留下同步記錄，稍後可能會再送一次。");
    }
  }

  function signature(dump) {
    return JSON.stringify(dump.votes.map(function (vote) {
      return { ingredientId: vote.ingredientId, choice: vote.choice, note: vote.note || "" };
    }));
  }

  function cloudPayload(dump) {
    return {
      kind: "ingredient-scout-votes",
      date: dump.date,
      ballotId: ballotId(),
      votes: dump.votes.map(function (vote) {
        return {
          ingredientId: vote.ingredientId,
          choice: vote.choice,
          note: vote.note || ""
        };
      })
    };
  }

  function needsCloudSync(dump) {
    if (!tallyEndpoint()) return false;
    const sig = signature(dump);
    if (sig === "[]" && !syncRecord()[dump.date]) return false;
    if (!channelSynced(dump.date, "sheet", sig)) return true;
    if (formspreeEndpoint() && !channelSynced(dump.date, "formspree", sig)) return true;
    return false;
  }

  function el(tag, attrs) {
    const node = document.createElement(tag);
    const children = Array.prototype.slice.call(arguments, 2);
    Object.entries(attrs || {}).forEach(function (pair) {
      const key = pair[0];
      const value = pair[1];
      if (value == null || value === false) return;
      if (key === "class") node.className = value;
      else node.setAttribute(key, String(value));
    });
    children.flat().forEach(function (child) {
      if (child == null || child === false) return;
      node.append(child.nodeType ? child : document.createTextNode(String(child)));
    });
    return node;
  }

  function announce(message) {
    $("live").textContent = message;
  }

  function currentDay() {
    return state.catalog.days.find((day) => day.date === state.date) || state.catalog.days[0];
  }

  function idsOf(day) {
    return day.picks.map((item) => item.id);
  }

  function dumpFor(date) {
    const day = state.catalog.days.find(function (item) { return item.date === date; });
    if (!day) return null;
    return VoteModel.toDump(state.votes, date, idsOf(day));
  }

  function dumpNow() {
    return dumpFor(state.date);
  }

  function safeHttp(url) {
    try {
      const parsed = new URL(url, window.location.href);
      if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return "";
      return parsed.href;
    } catch (error) {
      return "";
    }
  }

  function displayImage(image) {
    if (image.localPath && /^assets\/[A-Za-z0-9._/-]+$/.test(image.localPath)) return image.localPath;
    const remote = safeHttp(image.url);
    if (!remote) return "";
    const host = new URL(remote).hostname;
    if (host === "example.com" || host === "www.example.com") return "";
    return remote;
  }

  function fact(label, value, wide) {
    return el("div", wide ? { class: "wide" } : {}, el("dt", {}, label), el("dd", {}, value));
  }

  function renderCard(ingredient) {
    const row = (state.votes[state.date] || {})[ingredient.id] || {};
    const card = el("article", {
      class: "card",
      id: "ingredient-" + ingredient.id,
      "data-channel": ingredient.discovery.channel,
      "data-example": ingredient.example ? "true" : "false"
    });
    const head = el("header", {},
      el("div", { class: "kicker" },
        ingredient.example ? el("span", { class: "example-flag" }, "虛構範例") : null,
        el("span", { class: "chip" }, CHANNEL[ingredient.discovery.channel] || ingredient.discovery.channel),
        el("span", { class: "id" }, ingredient.id)
      ),
      el("h2", {}, ingredient.names.commonZh),
      el("p", { class: "sub" },
        ingredient.names.commonEn + " · ",
        el("i", {}, ingredient.names.scientific)
      ),
      el("p", { class: "trade" }, "商品名 " + ingredient.names.trade)
    );
    const facts = el("dl", { class: "facts" },
      fact("供應商", ingredient.supply.supplierName),
      fact("供應國", ingredient.supply.supplierCountry),
      fact("對台關係", RELATION[ingredient.supply.relationship] || ingredient.supply.relationship),
      fact("台灣關聯廠商", ingredient.supply.taiwanPartyName || "—"),
      fact("TFDA", el("span", {
        class: "stamp " + ingredient.tfda.usable
      }, TFDA[ingredient.tfda.usable] || ingredient.tfda.usable), true),
      fact("查詢日", ingredient.tfda.lookupDate),
      fact("偵察日", ingredient.discovery.scoutDate),
      fact("建議劑量", ingredient.efficacy.suggestedDosage, true),
      fact("專利", TRI[ingredient.patent.status] || ingredient.patent.status),
      fact("文獻", TRI[ingredient.literature.status] || ingredient.literature.status),
      fact("證據等級", evidenceNodes(ingredient.evidenceLevels), true)
    );
    const benefits = el("section", {},
      el("h3", {}, "宣稱效益"),
      el("ul", {}, ingredient.efficacy.claimedBenefits.map((item) => el("li", {}, item)))
    );
    const tfda = el("section", {},
      el("h3", {}, "TFDA 證據註記"),
      el("p", {}, ingredient.tfda.evidenceNotes),
      ingredient.efficacy.dosageNote ? el("p", { class: "scout" }, ingredient.efficacy.dosageNote) : null
    );
    const relation = el("p", {}, ingredient.supply.relationshipNote);
    const sources = el("section", { class: "sources" },
      el("h3", {}, "來源（" + ingredient.sources.length + "）"),
      el("ol", {}, ingredient.sources.map(sourceItem))
    );
    const figure = renderFigure(ingredient);
    const notes = el("p", { class: "scout" }, "偵察註記：" + ingredient.discovery.notes);
    const queries = renderQueries(ingredient);
    const vote = renderVote(ingredient, row);
    card.append(head, facts, relation, benefits, tfda, sources, figure, notes, queries, vote);
    return card;
  }

  function evidenceNodes(levels) {
    if (!levels || !levels.length) return "尚未標記";
    return el("span", { class: "tags" }, levels.map((level) => el("span", { class: "tag" }, EVIDENCE[level] || level)));
  }

  function sourceItem(source) {
    const href = safeHttp(source.url);
    const link = href
      ? el("a", { href: href, target: "_blank", rel: "noopener noreferrer" }, source.title)
      : source.title;
    return el("li", {},
      link,
      " · " + (CHANNEL[source.channel] || source.channel) + " · " + source.accessed,
      el("div", { class: "scout" }, source.whatItContributes)
    );
  }

  function renderFigure(ingredient) {
    const image = (ingredient.images || [])[0];
    if (!image) return null;
    const src = displayImage(image);
    const href = safeHttp(image.url);
    const figure = el("figure", { class: "figure" });
    if (src) {
      const img = el("img", { alt: image.caption || "原料圖片", src: src });
      img.addEventListener("error", function () {
        img.replaceWith(el("p", { class: "scout" }, "圖片網址目前顯示不了。"));
      });
      figure.append(img);
    }
    figure.append(el("figcaption", {},
      image.caption || "",
      href ? " " : "",
      href ? el("a", { href: href, target: "_blank", rel: "noopener noreferrer" }, "圖片網址") : null
    ));
    return figure;
  }

  function renderQueries(ingredient) {
    const rows = (ingredient.tfda.queries || []).map(function (query) {
      const count = query.resultCount === null || query.resultCount === undefined ? "未填" : String(query.resultCount);
      return el("li", {},
        (TAB[query.tab] || query.tab) + "／" + (query.keyword || "（無關鍵字）") + "／" + count + " 筆",
        query.note ? el("div", { class: "scout" }, query.note) : null
      );
    });
    return el("details", { class: "fold" },
      el("summary", {}, "TFDA 查詢紀錄"),
      el("ul", {}, rows),
      el("p", { class: "scout" }, ingredient.tfda.officialCrosscheck.notes || "")
    );
  }

  function renderVote(ingredient, row) {
    const choice = row.choice || "";
    const box = el("div", { class: "vote" });
    const teamLine = tallyEndpoint()
      ? el("p", { class: "team-line is-quiet", "data-team-for": ingredient.id }, "團隊累計讀取中…")
      : null;
    const actions = el("div", { class: "vote-actions" },
      voteButton("approve", "贊成", choice),
      voteButton("oppose", "反對", choice)
    );
    const saved = el("p", { class: "saved" }, choice ? "已記在這台裝置。" : "尚未表態。");
    const textarea = el("textarea", {
      rows: "3",
      maxlength: "1000",
      autocomplete: "off",
      "aria-label": ingredient.names.commonZh + " 的備註"
    });
    textarea.placeholder = "可寫猶豫的原因。不要留姓名、部門或信箱。";
    textarea.value = row.note || "";
    actions.addEventListener("click", function (event) {
      const button = event.target.closest("[data-choice]");
      if (!button) return;
      state.votes = VoteModel.cast(state.votes, {
        date: state.date,
        ingredientId: ingredient.id,
        choice: button.dataset.choice,
        note: textarea.value
      });
      saveVotes();
      markPressed(actions, button.dataset.choice);
      saved.textContent = "已記在這台裝置。";
      refreshChrome();
      announce("已記下對「" + ingredient.names.commonZh + "」的表態。");
      scheduleSync("choice");
    });
    textarea.addEventListener("input", function () {
      state.votes = VoteModel.setNote(state.votes, {
        date: state.date,
        ingredientId: ingredient.id,
        note: textarea.value
      });
      saveVotes();
      refreshChrome();
      scheduleSync("note");
    });
    if (teamLine) box.append(teamLine);
    box.append(actions, saved, el("label", { class: "note" }, "備註（不要寫姓名）", textarea));
    return box;
  }

  function voteButton(choice, label, current) {
    return el("button", {
      type: "button",
      "data-choice": choice,
      "aria-pressed": current === choice ? "true" : "false",
      class: current === choice ? "is-on" : ""
    }, label);
  }

  function markPressed(actions, choice) {
    actions.querySelectorAll("[data-choice]").forEach(function (button) {
      const on = button.dataset.choice === choice;
      button.setAttribute("aria-pressed", on ? "true" : "false");
      button.classList.toggle("is-on", on);
    });
  }

  function render() {
    const day = currentDay();
    const dateChanged = state.teamDate !== day.date;
    state.date = day.date;
    if (dateChanged) {
      state.team = null;
      state.teamError = false;
      state.teamDate = day.date;
    }
    $("date").value = day.date;
    const banner = $("banner");
    banner.replaceChildren();
    if (day.example) {
      banner.append(el("p", { class: "banner" }, "這一日是虛構練習。表態只用來熟悉流程，不能當成真實原料決策。"));
    }
    // 日報 notes 留在資料檔，投票頁不顯示。
    const list = $("list");
    list.replaceChildren();
    if (!day.picks.length) {
      list.append(el("p", {}, "這一天還沒有原料。"));
    } else {
      day.picks.forEach((ingredient) => list.append(renderCard(ingredient)));
    }
    refreshChrome();
    if (dateChanged) refreshTeam();
  }

  function localSummary() {
    const tally = VoteModel.tally(state.votes, state.date, idsOf(currentDay()));
    return {
      tally: tally,
      text: "本機已表態 " + tally.voted + "/" + tally.total + " · 贊成 " + tally.approve + " · 反對 " + tally.oppose
    };
  }

  function refreshChrome() {
    const summary = localSummary();
    const sheet = tallyEndpoint();
    const form = formspreeEndpoint();
    $("dock-tally").textContent = summary.text + (sheet ? "" : "（僅此瀏覽器）");
    if (sheet) {
      $("session-copy").textContent = summary.text + "。這是這台瀏覽器的數字，和上方的團隊累計分開計算。同一顆按鈕再按一次只會留下最新的選擇。";
    } else {
      $("session-copy").textContent = summary.text + "。這個數字只存在這台瀏覽器，還不是團隊總數。同一顆按鈕再按一次只會留下最新的選擇。";
    }
    const send = $("send");
    if (!sheet && !form) {
      send.hidden = true;
      $("backend-note").textContent = "尚未設定試算表或 Formspree。表態只留在這台裝置，可下載 JSON 留底。";
    } else if (sheet) {
      send.hidden = false;
      send.disabled = state.syncing;
      send.textContent = state.syncing ? "同步中…" : "立即同步";
      const backup = form ? "Formspree 會再收一份信件備份。" : "Formspree 目前沒填，不會另外寄信。";
      $("backend-note").textContent = "表態會自動寫進試算表，上方的團隊累計隨之更新。" + backup + "下載檔仍然留著。收集端網址寫在公開的設定檔，知道網址的人都能送資料。";
    } else {
      send.hidden = false;
      send.disabled = state.sending;
      const dump = dumpNow();
      const key = JSON.stringify(dump.votes);
      const sent = loadJson(localStorage, SENT_KEY, {});
      send.textContent = sent[state.date] === key && key !== "[]" ? "這份內容已送出" : "送到 Formspree";
      $("backend-note").textContent = "Formspree 只留信件備份，頁面不會出現團隊累計。沒送成功時，下載檔仍然有效。表單網址是公開的。";
    }
    const syncNote = $("sync-note");
    if (syncNote) {
      if (state.syncing) syncNote.textContent = "正在把這份表態送到收集端…";
      else if (state.lastSyncFailed) syncNote.textContent = "上次同步沒有成功。本機表態還在，可再按一次同步或下載 JSON。";
      else syncNote.textContent = "";
    }
    paintTeam();
  }

  function teamResultMap() {
    const map = Object.create(null);
    const results = state.team && Array.isArray(state.team.results) ? state.team.results : [];
    results.forEach(function (row) {
      if (!row || typeof row.ingredientId !== "string") return;
      map[row.ingredientId] = {
        approve: Math.max(0, Math.floor(Number(row.approve) || 0)),
        oppose: Math.max(0, Math.floor(Number(row.oppose) || 0)),
        notes: Array.isArray(row.notes) ? row.notes.map(function (note) { return String(note); }).filter(Boolean) : []
      };
    });
    return map;
  }

  function formatTeamCounts(row) {
    const approve = row ? row.approve : 0;
    const oppose = row ? row.oppose : 0;
    const notes = row && row.notes ? row.notes.length : 0;
    let text = "團隊累計 贊成 " + approve + " · 反對 " + oppose;
    if (notes) text += " · 備註 " + notes;
    return text;
  }

  function teamHeadline() {
    if (!state.team) return "";
    if (state.team.ballots == null) return "團隊累計已從試算表讀取。";
    if (state.team.ballots === 0) return "團隊累計尚無匿名票。";
    return "團隊累計 " + state.team.ballots + " 張匿名票。";
  }

  function paintTeam() {
    const panel = $("team-panel");
    const dock = $("dock-team");
    const copy = $("team-copy");
    if (!panel || !dock || !copy) return;
    if (!tallyEndpoint()) {
      panel.hidden = true;
      dock.hidden = true;
      return;
    }
    panel.hidden = false;
    dock.hidden = false;
    const stale = state.team && state.teamError ? "剛剛更新失敗，畫面上可能是稍早的數字。" : "";
    if (!state.team && state.teamError) {
      copy.textContent = "團隊累計暫時讀不到。請檢查網路或稍後重新整理。本機表態不受影響。";
      dock.textContent = "團隊累計暫時讀不到";
    } else if (!state.team) {
      copy.textContent = "正在讀取試算表上的團隊累計…";
      dock.textContent = "團隊累計讀取中…";
    } else {
      copy.textContent = teamHeadline() + "同一張匿名票對同一原料只算最新的選擇。這個表和本機數字分開。" + stale;
      dock.textContent = state.team.ballots == null
        ? "團隊累計已連線"
        : "團隊 " + state.team.ballots + " 張匿名票" + (state.teamError ? "（更新失敗）" : "");
    }
    document.querySelectorAll("[data-team-for]").forEach(function (node) {
      const id = node.getAttribute("data-team-for");
      node.classList.remove("is-quiet", "is-warn");
      if (!state.team && state.teamError) {
        node.textContent = "團隊累計暫時讀不到";
        node.classList.add("is-warn");
        return;
      }
      if (!state.team) {
        node.textContent = "團隊累計讀取中…";
        node.classList.add("is-quiet");
        return;
      }
      const map = teamResultMap();
      node.textContent = formatTeamCounts(map[id]) + (state.teamError ? "（更新失敗）" : "");
      if (state.teamError) node.classList.add("is-warn");
    });
    fillTeamTable();
  }

  function fillTeamTable() {
    const table = $("team-summary");
    if (!table) return;
    const body = table.querySelector("tbody");
    body.replaceChildren();
    if (!state.catalog) return;
    const day = currentDay();
    if (!state.team && !state.teamError) {
      body.append(el("tr", {}, el("td", { colspan: "4" }, "讀取中…")));
      return;
    }
    if (!state.team && state.teamError) {
      body.append(el("tr", {}, el("td", { colspan: "4" }, "暫時讀不到試算表。")));
      return;
    }
    const map = teamResultMap();
    day.picks.forEach(function (ingredient) {
      const row = map[ingredient.id] || { approve: 0, oppose: 0, notes: [] };
      body.append(el("tr", {},
        el("td", {}, ingredient.names.commonZh),
        el("td", {}, String(row.approve)),
        el("td", {}, String(row.oppose)),
        el("td", {}, row.notes.join(" / ") || "—")
      ));
    });
  }

  function normalizeTeam(data) {
    const ballots = Number(data.ballots);
    return {
      ok: true,
      date: data.date,
      ballots: Number.isFinite(ballots) ? ballots : null,
      results: Array.isArray(data.results) ? data.results : []
    };
  }

  function gasRedirectAction(status, location) {
    var code = Number(status);
    if (code >= 300 && code < 400 && location) {
      return { action: "get-echo", url: String(location) };
    }
    return { action: "read" };
  }

  function safeEchoUrl(location, base) {
    try {
      const url = new URL(location, base || window.location.href);
      const loopback = url.hostname === "localhost" || url.hostname === "127.0.0.1";
      if (url.protocol === "https:" || (loopback && url.protocol === "http:")) return url.href;
      return "";
    } catch (error) {
      return "";
    }
  }

  async function followGasEcho(response) {
    if (!response || !response.headers || typeof response.headers.get !== "function") return response;
    const action = gasRedirectAction(response.status, response.headers.get("Location"));
    if (action.action !== "get-echo") return response;
    const echo = safeEchoUrl(action.url, response.url || tallyEndpoint());
    if (!echo) return response;
    // 302 的 Location 是一次性的 echo。改用 GET 讀 JSON，不要再 POST。
    return fetchTimeout(echo, {
      method: "GET",
      redirect: "follow",
      credentials: "omit",
      referrerPolicy: "no-referrer",
      cache: "no-store"
    }, 12000);
  }

  async function readGasJson(response) {
    const followed = await followGasEcho(response);
    const text = await followed.text();
    try {
      return { response: followed, data: JSON.parse(text) };
    } catch (error) {
      return { response: followed, data: null };
    }
  }

  function fetchTimeout(url, options, ms) {
    const ctrl = typeof AbortController === "function" ? new AbortController() : null;
    const timer = setTimeout(function () {
      if (ctrl) ctrl.abort();
    }, ms);
    const opts = Object.assign({}, options);
    if (ctrl) opts.signal = ctrl.signal;
    return fetch(url, opts).finally(function () {
      clearTimeout(timer);
    });
  }

  async function fetchTalliesCors(date) {
    const url = new URL(tallyEndpoint());
    url.search = "";
    url.hash = "";
    url.searchParams.set("date", date);
    url.searchParams.set("_", String(Date.now()));
    const response = await fetchTimeout(url.href, {
      method: "GET",
      redirect: "follow",
      headers: { Accept: "application/json" },
      credentials: "omit",
      referrerPolicy: "no-referrer",
      cache: "no-store"
    }, 8000);
    const read = await readGasJson(response);
    if (!read.response.ok) throw new Error("status");
    const data = read.data;
    if (!data || data.ok === false) {
      const error = new Error("rejected");
      error.permanent = true;
      throw error;
    }
    if (!Array.isArray(data.results)) throw new Error("shape");
    return data;
  }

  function fetchTalliesJsonp(date) {
    return new Promise(function (resolve, reject) {
      const cb = "ingredientScoutTally" + String(Date.now()) + String(Math.floor(Math.random() * 1000));
      const url = new URL(tallyEndpoint());
      url.search = "";
      url.hash = "";
      url.searchParams.set("date", date);
      url.searchParams.set("callback", cb);
      url.searchParams.set("_", String(Date.now()));
      const script = document.createElement("script");
      let done = false;
      const timer = setTimeout(function () {
        finish(new Error("timeout"));
      }, 8000);
      function finish(error, data) {
        if (done) return;
        done = true;
        clearTimeout(timer);
        try { delete window[cb]; } catch (ignore) { window[cb] = undefined; }
        script.remove();
        if (error) reject(error);
        else resolve(data);
      }
      window[cb] = function (data) {
        if (!data || data.ok !== true || !Array.isArray(data.results)) {
          finish(new Error("shape"));
          return;
        }
        finish(null, data);
      };
      script.onerror = function () { finish(new Error("jsonp")); };
      script.src = url.href;
      document.head.append(script);
    });
  }

  async function fetchTallies(date) {
    try {
      return await fetchTalliesCors(date);
    } catch (error) {
      if (error && error.permanent) throw error;
      return fetchTalliesJsonp(date);
    }
  }

  async function refreshTeam() {
    if (!tallyEndpoint()) return;
    const gen = ++state.teamGen;
    const date = state.date;
    try {
      const data = await fetchTallies(date);
      if (gen !== state.teamGen || date !== state.date) return;
      state.team = normalizeTeam(data);
      state.teamError = false;
    } catch (error) {
      if (gen !== state.teamGen || date !== state.date) return;
      state.teamError = true;
    }
    paintTeam();
  }

  function scheduleSync(reason) {
    if (!tallyEndpoint()) return;
    if (reason) state.syncReason = reason;
    if (reason === "user" || reason === "choice" || reason === "note") state.nextSyncAt = 0;
    const date = state.date;
    state.pendingSyncDate = date;
    clearTimeout(state.syncTimer);
    state.syncTimer = setTimeout(function () {
      if (state.pendingSyncDate === date) state.pendingSyncDate = "";
      runSync({ force: false, date: date });
    }, SYNC_DELAY_MS);
  }

  async function runSync(options) {
    const force = Boolean(options && options.force);
    if (!tallyEndpoint()) return;
    const date = (options && options.date) || state.date;
    const dump = dumpFor(date);
    if (!dump) return;
    const sig = signature(dump);
    if (sig === "[]" && !syncRecord()[dump.date]) {
      if (force) announce("還沒有表態可送出。");
      return;
    }
    if (!force && !needsCloudSync(dump)) return;
    const acted = state.syncReason === "user" || state.syncReason === "choice" || state.syncReason === "note";
    if (!force && !acted && state.nextSyncAt && Date.now() < state.nextSyncAt) return;
    if (state.syncing) {
      state.syncQueued = true;
      state.queuedForce = state.queuedForce || force;
      state.queuedDate = date;
      if (state.syncReason === "user" || state.syncReason === "choice" || state.syncReason === "note") {
        state.queuedReason = state.syncReason;
      }
      return;
    }
    state.syncing = true;
    state.lastSyncFailed = false;
    if (state.pendingSyncDate === date) state.pendingSyncDate = "";
    const reason = state.syncReason;
    const visible = date === state.date;
    refreshChrome();
    try {
      const outcome = await postCloud(dump, force);
      state.syncBackoff = 0;
      state.nextSyncAt = 0;
      state.lastSyncFailed = false;
      if (visible && (reason === "user" || reason === "choice")) {
        const unconfirmed = outcome.sheetConfirmed === false;
        if (sig === "[]") {
          announce(unconfirmed ? "已送出清除，但讀不到試算表的回應。" : "已從試算表拿掉這張票。");
        } else if (unconfirmed) {
          announce("已送出同步，但瀏覽器讀不到試算表的回應。請稍後看團隊累計是否更新。");
        } else {
          announce("已同步到試算表。");
        }
      }
      if (visible) await refreshTeam();
    } catch (error) {
      state.lastSyncFailed = true;
      state.syncBackoff = Math.min(120000, state.syncBackoff ? state.syncBackoff * 2 : 5000);
      state.nextSyncAt = Date.now() + state.syncBackoff;
      if (visible && (reason === "user" || reason === "choice" || reason === "boot")) {
        announce((error && error.message) || "試算表沒有同步成功。這台裝置上的表態還在。");
      }
    } finally {
      state.syncing = false;
      if (state.syncReason === reason) state.syncReason = "auto";
      const again = state.syncQueued;
      const againForce = state.queuedForce;
      const againReason = state.queuedReason;
      const againDate = state.queuedDate;
      state.syncQueued = false;
      state.queuedForce = false;
      state.queuedReason = "";
      state.queuedDate = "";
      refreshChrome();
      if (again) {
        if (againReason) state.syncReason = againReason;
        runSync({ force: againForce, date: againDate || state.date });
      }
    }
  }

  async function postCloud(dump, force) {
    const sig = signature(dump);
    const jobs = [];
    let sheetConfirmed = true;
    const sendSheet = force || !channelSynced(dump.date, "sheet", sig);
    const sendForm = Boolean(formspreeEndpoint()) && (force || !channelSynced(dump.date, "formspree", sig));
    if (sendSheet) {
      jobs.push(postSheet(dump).then(function (result) {
        sheetConfirmed = Boolean(result && result.confirmed);
        markSynced(dump.date, "sheet", sig);
      }));
    }
    if (sendForm) {
      jobs.push(postFormspree(dump).then(function () {
        markSynced(dump.date, "formspree", sig);
      }));
    }
    if (!jobs.length) return { sheetConfirmed: true };
    const settled = await Promise.allSettled(jobs);
    const rejected = settled.find(function (item) { return item.status === "rejected"; });
    if (rejected) throw rejected.reason;
    return { sheetConfirmed: sheetConfirmed };
  }

  async function postSheet(dump) {
    const endpoint = tallyEndpoint();
    // Apps Script 不處理 OPTIONS 預檢，所以用 text/plain，不要改成 application/json。
    const init = {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(cloudPayload(dump)),
      redirect: "follow",
      credentials: "omit",
      referrerPolicy: "no-referrer",
      cache: "no-store"
    };
    try {
      // redirect:follow 會先 POST，再 GET echo。若仍看得到 302 與 Location，改發 GET。
      const response = await fetchTimeout(endpoint, init, 15000);
      const read = await readGasJson(response);
      const data = read.data;
      if (read.response.type === "opaqueredirect" || read.response.status === 0) return { confirmed: false };
      if (!read.response.ok) throw new Error("試算表回應 " + read.response.status + "。本機表態還在。");
      if (data && data.ok === false) throw new Error("試算表沒有收下這份票。本機表態還在。");
      if (data && data.ok === true) return { confirmed: true };
      return { confirmed: false };
    } catch (error) {
      if (error && error.message && error.message.indexOf("試算表") === 0) throw error;
      try {
        await fetch(endpoint, Object.assign({}, init, { mode: "no-cors" }));
        return { confirmed: false };
      } catch (again) {
        throw new Error("試算表連不上。本機表態還在，請稍後按「立即同步」或改下載 JSON。");
      }
    }
  }

  async function postFormspree(dump) {
    const endpoint = formspreeEndpoint();
    if (!endpoint) return;
    const body = new FormData();
    body.set("date", dump.date);
    body.set("ballotId", ballotId());
    body.set("votes", JSON.stringify(dump.votes));
    body.set("anonymous", "yes");
    body.set("_subject", "ingredient-scout " + dump.date);
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { Accept: "application/json" },
      body: body,
      credentials: "omit",
      referrerPolicy: "no-referrer"
    });
    if (!response.ok) throw new Error("Formspree 回應 " + response.status + "。本機表態還在。");
  }

  function flushSheet(date) {
    const dump = dumpFor(date);
    if (!dump) return;
    const sig = signature(dump);
    if (sig === "[]" && !syncRecord()[dump.date]) return;
    if (channelSynced(dump.date, "sheet", sig)) return;
    try {
      fetch(tallyEndpoint(), {
        method: "POST",
        mode: "no-cors",
        redirect: "follow",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify(cloudPayload(dump)),
        keepalive: true,
        credentials: "omit",
        referrerPolicy: "no-referrer"
      });
    } catch (error) {}
  }

  function pageHideSync() {
    if (!tallyEndpoint()) return;
    const pending = state.pendingSyncDate;
    clearTimeout(state.syncTimer);
    state.pendingSyncDate = "";
    const dates = [];
    if (pending) dates.push(pending);
    if (dates.indexOf(state.date) === -1) dates.push(state.date);
    dates.forEach(flushSheet);
  }

  function download(filename, data) {
    const blob = new Blob([JSON.stringify(data, null, 2) + "\n"], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = el("a", { href: url, download: filename });
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function downloadDump() {
    const dump = dumpNow();
    download("votes-" + state.date + ".json", dump);
    announce("已下載 " + dump.votes.length + " 筆表態。檔案裡沒有姓名。");
  }

  async function copyShare() {
    const dump = dumpNow();
    if (!dump.votes.length) {
      announce("還沒有表態可分享。");
      return;
    }
    const url = new URL(window.location.href);
    url.searchParams.set("date", state.date);
    url.hash = "ballot=" + VoteModel.encodeShare(dump);
    const text = url.toString();
    try {
      await navigator.clipboard.writeText(text);
      $("share-fallback").hidden = true;
      announce("已複製分享連結。連結只含投票內容。");
    } catch (error) {
      $("share-fallback").hidden = false;
      $("share-url").value = text;
      $("share-url").focus();
      $("share-url").select();
      announce("請手動複製連結。");
    }
  }

  async function sendDump() {
    if (tallyEndpoint()) {
      state.syncReason = "user";
      state.nextSyncAt = 0;
      clearTimeout(state.syncTimer);
      await runSync({ force: true });
      return;
    }
    const dump = dumpNow();
    if (!dump.votes.length) {
      announce("還沒有表態可送出。");
      return;
    }
    const key = JSON.stringify(dump.votes);
    const sent = loadJson(localStorage, SENT_KEY, {});
    if (sent[state.date] === key) {
      announce("這份內容已經送出過。");
      return;
    }
    state.sending = true;
    refreshChrome();
    try {
      await postFormspree(dump);
      sent[state.date] = key;
      localStorage.setItem(SENT_KEY, JSON.stringify(sent));
      announce("已送到 Formspree。請仍保留下載檔。");
    } catch (error) {
      announce(error.message || "Formspree 沒有收下。這台裝置上的表態還在。");
    } finally {
      state.sending = false;
      refreshChrome();
    }
  }

  function clearDay() {
    if (!window.confirm("清除這台裝置上 " + state.date + " 的表態？已下載的檔案不會被刪掉。")) return;
    state.votes = VoteModel.clearDate(state.votes, state.date);
    saveVotes();
    render();
    announce("已清除這日的本機表態。");
    scheduleSync("user");
  }

  function consumeHash() {
    const match = window.location.hash.match(/^#ballot=([A-Za-z0-9_-]+)$/);
    if (!match) return;
    const url = new URL(window.location.href);
    const previous = state.date;
    url.hash = "";
    try {
      const dump = VoteModel.decodeShare(match[1]);
      if (!url.searchParams.get("date") && state.catalog.days.some((day) => day.date === dump.date)) {
        state.date = dump.date;
        url.searchParams.set("date", dump.date);
      }
    } catch (error) {
      announce("這條分享連結讀不起來。");
    }
    history.replaceState(null, "", url);
    if (state.ready && state.date !== previous) render();
  }

  const SEARCH_LIMIT = 8;

  function searchGlyph() {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "search-glyph");
    svg.setAttribute("width", "15");
    svg.setAttribute("height", "15");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    circle.setAttribute("cx", "11");
    circle.setAttribute("cy", "11");
    circle.setAttribute("r", "6.5");
    circle.setAttribute("fill", "none");
    circle.setAttribute("stroke", "currentColor");
    circle.setAttribute("stroke-width", "2");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", "M16.2 16.2L21 21");
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", "currentColor");
    path.setAttribute("stroke-width", "2");
    path.setAttribute("stroke-linecap", "round");
    svg.append(circle, path);
    return svg;
  }

  function foldForHighlight(text) {
    return String(text || "").replace(/[\uFF01-\uFF5E]/g, function (ch) {
      return String.fromCharCode(ch.charCodeAt(0) - 0xfee0);
    }).toLowerCase();
  }

  function highlighted(text, tokens) {
    const source = String(text || "");
    const frag = document.createDocumentFragment();
    if (!source) return frag;
    const folded = foldForHighlight(source);
    const ranges = [];
    (tokens || []).forEach(function (token) {
      if (!token) return;
      let from = 0;
      while (from < folded.length) {
        const at = folded.indexOf(token, from);
        if (at < 0) break;
        ranges.push([at, at + token.length]);
        from = at + token.length;
      }
    });
    ranges.sort(function (a, b) { return a[0] - b[0] || a[1] - b[1]; });
    const merged = [];
    ranges.forEach(function (range) {
      const last = merged[merged.length - 1];
      if (!last || range[0] > last[1]) merged.push([range[0], range[1]]);
      else last[1] = Math.max(last[1], range[1]);
    });
    let cursor = 0;
    merged.forEach(function (range) {
      if (range[0] > cursor) frag.append(document.createTextNode(source.slice(cursor, range[0])));
      frag.append(el("mark", {}, source.slice(range[0], range[1])));
      cursor = range[1];
    });
    if (cursor < source.length) frag.append(document.createTextNode(source.slice(cursor)));
    return frag;
  }

  function searchMeta(hit) {
    const parts = [];
    if (hit.snippet) parts.push(hit.snippet);
    else if (hit.hint) parts.push(hit.hint);
    if (hit.dates && hit.dates.length) parts.push(hit.dates.join("、"));
    return parts.join(" · ");
  }

  function closeSearch() {
    state.searchOpen = false;
    state.searchResults = [];
    state.searchActive = -1;
    state.searchExtra = 0;
    const panel = $("search-panel");
    const input = $("ingredient-search");
    const list = $("search-list");
    if (list) list.replaceChildren();
    if (panel) panel.hidden = true;
    if (input) {
      input.setAttribute("aria-expanded", "false");
      input.removeAttribute("aria-activedescendant");
    }
  }

  function paintSearchActive() {
    const list = $("search-list");
    const input = $("ingredient-search");
    if (!list || !input) return;
    const options = list.querySelectorAll("[role='option']");
    options.forEach(function (node, index) {
      const on = index === state.searchActive;
      node.classList.toggle("is-active", on);
      node.setAttribute("aria-selected", on ? "true" : "false");
    });
    const active = state.searchActive >= 0 ? $("search-opt-" + state.searchActive) : null;
    if (active) {
      input.setAttribute("aria-activedescendant", active.id);
      const panel = $("search-panel");
      const top = active.offsetTop;
      const bottom = top + active.offsetHeight;
      if (top < panel.scrollTop) panel.scrollTop = top;
      else if (bottom > panel.scrollTop + panel.clientHeight) panel.scrollTop = bottom - panel.clientHeight;
    } else {
      input.removeAttribute("aria-activedescendant");
    }
  }

  function renderSearchOption(hit, index, tokens) {
    const option = el("li", {
      id: "search-opt-" + index,
      role: "option",
      class: "search-option" + (index === state.searchActive ? " is-active" : ""),
      "aria-selected": index === state.searchActive ? "true" : "false"
    });
    option.append(
      searchGlyph(),
      el("span", { class: "search-copy" },
        el("span", { class: "search-label" }, highlighted(hit.label, tokens)),
        el("span", { class: "search-meta" }, highlighted(searchMeta(hit), tokens))
      )
    );
    option.addEventListener("mousedown", function (event) { event.preventDefault(); });
    option.addEventListener("click", function () { chooseSearch(index); });
    option.addEventListener("mousemove", function () {
      if (state.searchActive === index) return;
      state.searchActive = index;
      paintSearchActive();
    });
    return option;
  }

  function paintSearchList(tokens) {
    const list = $("search-list");
    const panel = $("search-panel");
    const input = $("ingredient-search");
    list.replaceChildren();
    state.searchOpen = true;
    panel.hidden = false;
    input.setAttribute("aria-expanded", "true");
    if (!state.searchResults.length) {
      list.append(el("li", { class: "search-empty", role: "presentation" }, "找不到"));
      input.removeAttribute("aria-activedescendant");
      return;
    }
    state.searchResults.forEach(function (hit, index) {
      list.append(renderSearchOption(hit, index, tokens));
    });
    if (state.searchExtra > 0) {
      list.append(el("li", { class: "search-more", role: "presentation" }, "還有 " + state.searchExtra + " 筆，請再縮小關鍵字"));
    }
    paintSearchActive();
  }

  function updateSearch(open) {
    const input = $("ingredient-search");
    if (!input || !window.SearchModel) return;
    const query = input.value;
    const tokens = SearchModel.tokensOf(query);
    if (!tokens.length) {
      state.searchResults = [];
      state.searchExtra = 0;
      state.searchActive = -1;
      closeSearch();
      return;
    }
    const matches = SearchModel.search(state.searchIndex, query);
    state.searchExtra = Math.max(0, matches.length - SEARCH_LIMIT);
    state.searchResults = matches.slice(0, SEARCH_LIMIT);
    state.searchActive = state.searchResults.length ? 0 : -1;
    if (!open && !state.searchOpen) return;
    paintSearchList(tokens);
  }

  function openIngredient(id, date, label) {
    const days = state.catalog.days || [];
    const onDate = days.find(function (day) {
      return day.date === date && (day.picks || []).some(function (item) { return item.id === id; });
    });
    const host = onDate || days.find(function (day) {
      return (day.picks || []).some(function (item) { return item.id === id; });
    });
    if (!host) {
      announce("目錄裡找不到這筆原料。");
      return;
    }
    state.date = host.date;
    const url = new URL(window.location.href);
    url.searchParams.set("date", host.date);
    url.hash = "ingredient-" + id;
    history.replaceState(null, "", url);
    render();
    const card = document.getElementById("ingredient-" + id);
    if (!card) return;
    card.classList.add("is-located");
    card.tabIndex = -1;
    const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    card.scrollIntoView({ block: "start", behavior: reduce ? "auto" : "smooth" });
    card.focus({ preventScroll: true });
    announce("已打開「" + (label || id) + "」，日期 " + host.date + "。");
    window.setTimeout(function () {
      card.classList.remove("is-located");
    }, 4000);
  }

  function chooseSearch(index) {
    const hit = state.searchResults[index];
    if (!hit) return;
    const input = $("ingredient-search");
    input.value = hit.label;
    closeSearch();
    openIngredient(hit.id, hit.date, hit.label);
  }

  function bindSearch() {
    const input = $("ingredient-search");
    const field = $("search-field");
    if (!input || !field || !window.SearchModel) return;
    input.addEventListener("compositionstart", function () { state.composing = true; });
    input.addEventListener("compositionend", function () {
      state.composing = false;
      updateSearch(true);
    });
    input.addEventListener("input", function () {
      if (state.composing) return;
      updateSearch(true);
    });
    input.addEventListener("focus", function () {
      updateSearch(true);
    });
    input.addEventListener("keydown", function (event) {
      if (event.isComposing || state.composing) return;
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const wasOpen = state.searchOpen;
        if (!wasOpen) updateSearch(true);
        if (!state.searchResults.length || !wasOpen) return;
        if (event.key === "ArrowDown") {
          state.searchActive = Math.min(state.searchResults.length - 1, Math.max(0, state.searchActive) + 1);
        } else {
          state.searchActive = Math.max(0, state.searchActive < 0 ? 0 : state.searchActive - 1);
        }
        paintSearchActive();
      } else if (event.key === "Enter") {
        if (!SearchModel.tokensOf(input.value).length) return;
        if (!state.searchOpen) updateSearch(true);
        if (state.searchActive < 0 || !state.searchResults[state.searchActive]) return;
        event.preventDefault();
        chooseSearch(state.searchActive);
      } else if (event.key === "Escape") {
        if (!state.searchOpen) return;
        event.preventDefault();
        closeSearch();
      }
    });
    input.addEventListener("blur", function () {
      window.setTimeout(function () {
        if (!field.contains(document.activeElement)) closeSearch();
      }, 0);
    });
    document.addEventListener("pointerdown", function (event) {
      if (!field.contains(event.target)) closeSearch();
    });
  }

  function bind() {
    $("date").addEventListener("change", function () {
      state.date = $("date").value;
      const url = new URL(window.location.href);
      url.searchParams.set("date", state.date);
      url.hash = "";
      history.replaceState(null, "", url);
      render();
    });
    $("download").addEventListener("click", downloadDump);
    $("download-dock").addEventListener("click", downloadDump);
    $("copy").addEventListener("click", copyShare);
    $("send").addEventListener("click", function () {
      sendDump();
    });
    $("clear").addEventListener("click", clearDay);
  }

  function boot() {
    const team = $("team-label");
    if (cfg.teamLabel) team.textContent = cfg.teamLabel;
    const readme = $("readme-link");
    const repo = String(cfg.repoUrl || "").replace(/\/$/, "");
    if (/^https:\/\/github\.com\/[^/]+\/[^/]+$/.test(repo)) {
      readme.href = repo + "/blob/main/README.md";
    } else {
      readme.hidden = true;
    }
    if (!state.catalog || !Array.isArray(state.catalog.days) || !state.catalog.days.length) {
      $("list").textContent = "讀不到原料目錄。請在專案根目錄執行 node scripts/build-catalog.mjs，再用網頁伺服器開啟這個資料夾。";
      $("dock-tally").textContent = "目錄讀取失敗";
      const searchInput = $("ingredient-search");
      if (searchInput) searchInput.disabled = true;
      return;
    }
    if (window.SearchModel) state.searchIndex = SearchModel.buildIndex(state.catalog.days);
    const select = $("date");
    state.catalog.days.forEach(function (day) {
      select.append(el("option", { value: day.date }, day.date + " " + (day.title || "") + (day.example ? "（練習）" : "")));
    });
    const requested = new URLSearchParams(window.location.search).get("date");
    state.date = state.catalog.days.some((day) => day.date === requested) ? requested : state.catalog.days[0].date;
    bind();
    bindSearch();
    consumeHash();
    window.addEventListener("hashchange", consumeHash);
    window.addEventListener("pagehide", pageHideSync);
    render();
    state.ready = true;
    if (tallyEndpoint()) {
      if (needsCloudSync(dumpNow())) scheduleSync("boot");
      state.pollTimer = setInterval(function () {
        refreshTeam();
        if (needsCloudSync(dumpNow())) {
          state.syncReason = "auto";
          runSync({ force: false });
        }
      }, POLL_MS);
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();

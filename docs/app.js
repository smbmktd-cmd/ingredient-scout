(function () {
  const $ = (id) => document.getElementById(id);
  const cfg = window.VOTE_CONFIG || {};
  const VOTES_KEY = "ingredient-scout.votes.v1";
  const SENT_KEY = "ingredient-scout.sent.v1";
  const TRAY_KEY = "ingredient-scout.tray.v1";

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
    tray: loadJson(sessionStorage, TRAY_KEY, []),
    sending: false,
    ready: false,
    skipped: 0
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

  function saveTray() {
    sessionStorage.setItem(TRAY_KEY, JSON.stringify(state.tray));
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

  function dumpNow() {
    return VoteModel.toDump(state.votes, state.date, idsOf(currentDay()));
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
      fact("台灣窗口", ingredient.supply.taiwanPartyName || "—"),
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
    });
    textarea.addEventListener("input", function () {
      state.votes = VoteModel.setNote(state.votes, {
        date: state.date,
        ingredientId: ingredient.id,
        note: textarea.value
      });
      saveVotes();
      refreshChrome();
    });
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
    state.date = day.date;
    $("date").value = day.date;
    const banner = $("banner");
    banner.replaceChildren();
    if (day.example) {
      banner.append(el("p", { class: "banner" }, "這一日是虛構練習。表態只用來熟悉流程，不能當成真實原料決策。"));
    }
    if (day.notes) banner.append(el("p", { class: "day-note" }, day.notes));
    const list = $("list");
    list.replaceChildren();
    if (!day.picks.length) {
      list.append(el("p", {}, "這一天還沒有原料。"));
    } else {
      day.picks.forEach((ingredient) => list.append(renderCard(ingredient)));
    }
    renderTray();
    refreshChrome();
  }

  function refreshChrome() {
    const day = currentDay();
    const tally = VoteModel.tally(state.votes, state.date, idsOf(day));
    const text = "本機已表態 " + tally.voted + "/" + tally.total + " · 贊成 " + tally.approve + " · 反對 " + tally.oppose;
    $("dock-tally").textContent = text + "（僅此瀏覽器）";
    $("session-copy").textContent = text + "。這個數字只存在這台瀏覽器，還不是團隊總數。同一顆按鈕再按一次只會留下最新的選擇。";
    const endpoint = httpsEndpoint();
    const send = $("send");
    if (!endpoint || !cfg.submitMode) {
      send.hidden = true;
      $("backend-note").textContent = "共享收集端未設定。請下載 JSON，交給負責彙總的同事。";
    } else {
      send.hidden = false;
      send.disabled = state.sending;
      const sent = loadJson(localStorage, SENT_KEY, {});
      const key = JSON.stringify(dumpNow().votes);
      send.textContent = sent[state.date] === key && key !== "[]" ? "這份內容已送出" : "送到共享收集端";
      $("backend-note").textContent = "共享收集端是可選的。沒送成功時，下載檔仍然有效。正式計票以工作人員彙總為準。";
    }
  }

  function httpsEndpoint() {
    try {
      const url = new URL(cfg.submitEndpoint || "");
      return url.protocol === "https:" ? url.href : "";
    } catch (error) {
      return "";
    }
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
      await postDump(dump);
      sent[state.date] = key;
      localStorage.setItem(SENT_KEY, JSON.stringify(sent));
      announce("已送到共享收集端。請仍保留下載檔，方便彙總。");
    } catch (error) {
      announce(error.message || "共享收集端沒有收下。這台裝置上的表態還在。");
    } finally {
      state.sending = false;
      refreshChrome();
    }
  }

  async function postDump(dump) {
    const endpoint = httpsEndpoint();
    if (!endpoint) throw new Error("收集端網址需為 https。");
    if (cfg.submitMode === "formspree") {
      const body = new FormData();
      body.set("date", dump.date);
      body.set("votes", JSON.stringify(dump.votes));
      body.set("anonymous", "yes");
      body.set("_subject", "ingredient-scout " + dump.date);
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { Accept: "application/json" },
        body: body
      });
      if (!response.ok) throw new Error("收集端回應 " + response.status + "。請改下載 JSON。");
      return;
    }
    if (cfg.submitMode === "webhook") {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify(dump)
      });
      if (!response.ok) throw new Error("收集端回應 " + response.status + "。請改下載 JSON。");
      return;
    }
    throw new Error("submitMode 需為 formspree 或 webhook。");
  }

  function clearDay() {
    if (!window.confirm("清除這台裝置上 " + state.date + " 的表態？已下載的檔案不會被刪掉。")) return;
    state.votes = VoteModel.clearDate(state.votes, state.date);
    saveVotes();
    render();
    announce("已清除這日的本機表態。");
  }

  function addTray(dump, label) {
    const key = dump.date + "\n" + JSON.stringify(dump.votes);
    if (state.tray.some((item) => item.key === key)) {
      state.skipped += 1;
      renderTray();
      announce("這份投票已經在彙總區。");
      return false;
    }
    state.tray.push({ key: key, label: label, dump: dump });
    saveTray();
    renderTray();
    announce("已併入 " + dump.date + " 的一份投票。");
    return true;
  }

  function importText(text, label) {
    const raw = text.trim();
    if (!raw) return;
    const hash = raw.match(/#ballot=([A-Za-z0-9_-]+)/);
    if (hash) {
      addTray(VoteModel.decodeShare(hash[1]), label || "分享連結");
      return;
    }
    addTray(VoteModel.parseDump(raw), label || "貼上的 JSON");
  }

  function renderTray() {
    const note = $("tray-note");
    const list = $("tray");
    const body = $("summary").querySelector("tbody");
    list.replaceChildren();
    state.tray.forEach(function (item, index) {
      const remove = el("button", { type: "button" }, "移除");
      remove.addEventListener("click", function () {
        state.tray.splice(index, 1);
        saveTray();
        renderTray();
      });
      list.append(el("li", {}, item.label + " · " + item.dump.date + " · " + item.dump.votes.length + " 票", remove));
    });
    const dumps = state.tray.map((item) => item.dump);
    const merged = VoteModel.mergeDumps(dumps, idsOf(currentDay()), state.date);
    const bits = ["這一天併入 " + merged.ballots + " 份"];
    const skipped = merged.duplicates + state.skipped;
    if (skipped) bits.push("略過重複 " + skipped + " 份");
    if (merged.otherDates) bits.push("其他日期 " + merged.otherDates + " 份未計入");
    note.textContent = state.tray.length ? bits.join("，") + "。" : "尚未匯入。";
    body.replaceChildren();
    merged.results.forEach(function (row) {
      const ingredient = currentDay().picks.find((item) => item.id === row.ingredientId);
      body.append(el("tr", {},
        el("td", {}, ingredient ? ingredient.names.commonZh : row.ingredientId),
        el("td", {}, String(row.approve)),
        el("td", {}, String(row.oppose)),
        el("td", {}, row.notes.join(" / ") || "—")
      ));
    });
  }

  function downloadSummary() {
    const merged = VoteModel.mergeDumps(state.tray.map((item) => item.dump), idsOf(currentDay()), state.date);
    if (!merged.ballots) {
      announce("彙總區還沒有這一天的投票。");
      return;
    }
    download("vote-summary-" + state.date + ".json", VoteModel.summaryDocument(merged, state.date));
    announce("已下載彙總。可存到 data/votes/。");
  }

  function consumeHash() {
    const match = window.location.hash.match(/^#ballot=([A-Za-z0-9_-]+)$/);
    if (!match) return;
    try {
      const dump = VoteModel.decodeShare(match[1]);
      const url = new URL(window.location.href);
      const previous = state.date;
      url.hash = "";
      if (!url.searchParams.get("date") && state.catalog.days.some((day) => day.date === dump.date)) {
        state.date = dump.date;
        url.searchParams.set("date", dump.date);
      }
      history.replaceState(null, "", url);
      const added = addTray(dump, "分享連結");
      $("staff").open = true;
      if (state.ready && state.date !== previous) render();
      if (added) announce("已把連結裡的投票放進工作人員區，沒有改你自己的表態。");
    } catch (error) {
      announce("這條分享連結讀不起來。");
    }
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
    $("send").addEventListener("click", sendDump);
    $("clear").addEventListener("click", clearDay);
    $("import-paste").addEventListener("click", function () {
      try {
        importText($("paste").value, "貼上的內容");
        $("paste").value = "";
      } catch (error) {
        announce(error.message || "這段內容不是投票檔。");
      }
    });
    $("files").addEventListener("change", function () {
      const files = Array.from($("files").files || []);
      files.forEach(function (file) {
        const reader = new FileReader();
        reader.onload = function () {
          try {
            importText(String(reader.result || ""), file.name);
          } catch (error) {
            announce(file.name + " 讀不起來。" + (error.message || ""));
          }
        };
        reader.readAsText(file);
      });
      $("files").value = "";
    });
    $("download-summary").addEventListener("click", downloadSummary);
    $("clear-tray").addEventListener("click", function () {
      state.tray = [];
      state.skipped = 0;
      saveTray();
      renderTray();
      announce("已清空彙總區。");
    });
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
      return;
    }
    const select = $("date");
    state.catalog.days.forEach(function (day) {
      select.append(el("option", { value: day.date }, day.date + " " + (day.title || "") + (day.example ? "（練習）" : "")));
    });
    const requested = new URLSearchParams(window.location.search).get("date");
    state.date = state.catalog.days.some((day) => day.date === requested) ? requested : state.catalog.days[0].date;
    bind();
    consumeHash();
    window.addEventListener("hashchange", consumeHash);
    render();
    state.ready = true;
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();

/* 匿名投票的純資料邏輯。瀏覽器與 node 測試共用。不記錄身分。 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.VoteModel = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const CHOICES = ["approve", "oppose"];
  const DUMP_KEYS = [
    "kind",
    "version",
    "date",
    "exportedAt",
    "source",
    "anonymous",
    "votes",
    "missingIngredientIds",
    "complete"
  ];
  const VOTE_KEYS = ["ingredientId", "choice", "note", "updatedAt"];
  const FORBIDDEN = [
    "name",
    "email",
    "user",
    "username",
    "login",
    "ip",
    "phone",
    "author",
    "scoutname"
  ];

  function normalizeNote(note) {
    return String(note ?? "").replace(/\u0000/g, "").slice(0, 1000);
  }

  function isDate(value) {
    return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
  }

  function isId(value) {
    return typeof value === "string" && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
  }

  function assertNoIdentity(value, path) {
    if (Array.isArray(value)) {
      value.forEach((item, index) => assertNoIdentity(item, path + "[" + index + "]"));
      return;
    }
    if (!value || typeof value !== "object") return;
    for (const key of Object.keys(value)) {
      if (FORBIDDEN.includes(key.toLowerCase())) {
        throw new Error("投票檔含有身分欄位：" + path + "." + key);
      }
      assertNoIdentity(value[key], path ? path + "." + key : key);
    }
  }

  function dayOf(state, date) {
    return state && state[date] ? state[date] : {};
  }

  function cast(state, input) {
    if (!isDate(input.date)) throw new Error("日期格式需為 YYYY-MM-DD");
    if (!isId(input.ingredientId)) throw new Error("原料 id 格式不正確");
    if (!CHOICES.includes(input.choice)) throw new Error("表態需為贊成或反對");
    const now = input.now || new Date().toISOString();
    const prev = dayOf(state, input.date)[input.ingredientId];
    const note = input.note === undefined ? (prev ? prev.note : "") : normalizeNote(input.note);
    const nextDay = Object.assign({}, dayOf(state, input.date));
    nextDay[input.ingredientId] = {
      choice: input.choice,
      note: note,
      updatedAt: now
    };
    const next = Object.assign({}, state);
    next[input.date] = nextDay;
    return next;
  }

  function setNote(state, input) {
    if (!isDate(input.date)) throw new Error("日期格式需為 YYYY-MM-DD");
    if (!isId(input.ingredientId)) throw new Error("原料 id 格式不正確");
    const now = input.now || new Date().toISOString();
    const prev = dayOf(state, input.date)[input.ingredientId] || {
      choice: null,
      note: "",
      updatedAt: now
    };
    const nextDay = Object.assign({}, dayOf(state, input.date));
    nextDay[input.ingredientId] = {
      choice: prev.choice || null,
      note: normalizeNote(input.note),
      updatedAt: now
    };
    const next = Object.assign({}, state);
    next[input.date] = nextDay;
    return next;
  }

  function clearDate(state, date) {
    const next = Object.assign({}, state);
    delete next[date];
    return next;
  }

  function tally(state, date, ids) {
    const day = dayOf(state, date);
    let approve = 0;
    let oppose = 0;
    for (const id of ids) {
      const row = day[id];
      if (!row || !row.choice) continue;
      if (row.choice === "approve") approve += 1;
      if (row.choice === "oppose") oppose += 1;
    }
    return {
      approve: approve,
      oppose: oppose,
      voted: approve + oppose,
      total: ids.length
    };
  }

  function toDump(state, date, ingredientIds, now) {
    const ids = ingredientIds || [];
    const day = dayOf(state, date);
    const votes = [];
    const missing = [];
    for (const id of ids) {
      const row = day[id];
      if (!row || !row.choice) {
        missing.push(id);
        continue;
      }
      votes.push({
        ingredientId: id,
        choice: row.choice,
        note: normalizeNote(row.note).trim(),
        updatedAt: row.updatedAt || now || new Date().toISOString()
      });
    }
    return {
      kind: "ingredient-scout-votes",
      version: 1,
      date: date,
      exportedAt: now || new Date().toISOString(),
      source: "browser-session",
      anonymous: true,
      votes: votes,
      missingIngredientIds: missing,
      complete: missing.length === 0 && ids.length > 0
    };
  }

  function parseDump(input) {
    const dump = typeof input === "string" ? JSON.parse(input) : input;
    if (!dump || typeof dump !== "object" || Array.isArray(dump)) {
      throw new Error("投票檔不是物件");
    }
    assertNoIdentity(dump, "");
    for (const key of Object.keys(dump)) {
      if (!DUMP_KEYS.includes(key)) throw new Error("投票檔有未允許的欄位：" + key);
    }
    if (dump.kind !== "ingredient-scout-votes") throw new Error("不是原料投票檔");
    if (dump.version !== 1) throw new Error("投票檔版本不符");
    if (!isDate(dump.date)) throw new Error("投票檔日期不正確");
    if (dump.source !== "browser-session") throw new Error("投票檔來源標記不符");
    if (dump.anonymous !== true) throw new Error("投票檔必須標成匿名");
    if (Number.isNaN(Date.parse(dump.exportedAt))) throw new Error("匯出時間不正確");
    if (!Array.isArray(dump.votes) || dump.votes.length > 50) throw new Error("投票筆數不正確");
    const seen = new Set();
    for (const vote of dump.votes) {
      if (!vote || typeof vote !== "object") throw new Error("投票內容不完整");
      for (const key of Object.keys(vote)) {
        if (!VOTE_KEYS.includes(key)) throw new Error("單筆投票有未允許的欄位");
      }
      if (!isId(vote.ingredientId)) throw new Error("原料 id 格式不正確");
      if (seen.has(vote.ingredientId)) throw new Error("同一份投票檔對同一原料投了兩次");
      seen.add(vote.ingredientId);
      if (!CHOICES.includes(vote.choice)) throw new Error("表態需為贊成或反對");
      if (typeof vote.note !== "string" || vote.note.length > 1000) throw new Error("備註過長");
      if (Number.isNaN(Date.parse(vote.updatedAt))) throw new Error("表態時間不正確");
    }
    if (dump.missingIngredientIds !== undefined) {
      if (!Array.isArray(dump.missingIngredientIds)) throw new Error("缺票清單格式不正確");
      for (const id of dump.missingIngredientIds) {
        if (!isId(id)) throw new Error("缺票清單含有不正確的 id");
      }
    }
    if (dump.complete !== undefined && typeof dump.complete !== "boolean") {
      throw new Error("完成標記格式不正確");
    }
    return dump;
  }

  function encodeShare(dump) {
    const parsed = parseDump(dump);
    const bytes = new TextEncoder().encode(JSON.stringify(parsed));
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
  }

  function decodeShare(token) {
    if (typeof token !== "string" || !/^[A-Za-z0-9_-]+$/.test(token)) {
      throw new Error("分享碼格式不正確");
    }
    const pad = token.length % 4 === 0 ? "" : "=".repeat(4 - (token.length % 4));
    const binary = atob(token.replaceAll("-", "+").replaceAll("_", "/") + pad);
    const bytes = Uint8Array.from(binary, function (ch) {
      return ch.charCodeAt(0);
    });
    return parseDump(new TextDecoder().decode(bytes));
  }

  function mergeDumps(dumps, ingredientIds, date) {
    const seen = new Set();
    let duplicates = 0;
    let otherDates = 0;
    const unique = [];
    for (const dump of dumps) {
      if (date && dump.date !== date) {
        otherDates += 1;
        continue;
      }
      const key = dump.date + "\n" + JSON.stringify(dump.votes);
      if (seen.has(key)) {
        duplicates += 1;
        continue;
      }
      seen.add(key);
      unique.push(dump);
    }
    const ordered = [];
    const known = new Set();
    for (const id of ingredientIds || []) {
      if (!known.has(id)) {
        known.add(id);
        ordered.push(id);
      }
    }
    for (const dump of unique) {
      for (const vote of dump.votes) {
        if (!known.has(vote.ingredientId)) {
          known.add(vote.ingredientId);
          ordered.push(vote.ingredientId);
        }
      }
    }
    const results = ordered.map(function (id) {
      return { ingredientId: id, approve: 0, oppose: 0, notes: [] };
    });
    const byId = new Map(results.map(function (row) {
      return [row.ingredientId, row];
    }));
    for (const dump of unique) {
      for (const vote of dump.votes) {
        const row = byId.get(vote.ingredientId);
        if (vote.choice === "approve") row.approve += 1;
        if (vote.choice === "oppose") row.oppose += 1;
        if (vote.note) row.notes.push(vote.note);
      }
    }
    return {
      ballots: unique.length,
      duplicates: duplicates,
      otherDates: otherDates,
      results: results
    };
  }

  function summaryDocument(merged, date, now) {
    return {
      kind: "ingredient-scout-vote-summary",
      version: 1,
      date: date,
      aggregatedAt: now || new Date().toISOString(),
      anonymous: true,
      ballots: merged.ballots,
      results: merged.results
    };
  }

  function copyRow(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    let choice = null;
    if (value.choice === "approve" || value.choice === "oppose") choice = value.choice;
    else if (value.choice != null && value.choice !== "") return null;
    const note = normalizeNote(value.note);
    if (!choice && !note) return null;
    return {
      choice: choice,
      note: note,
      updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : ""
    };
  }

  function dayFrom(value) {
    const day = {};
    if (Array.isArray(value)) {
      value.forEach(function (item) {
        if (!item || !isId(item.ingredientId)) return;
        const row = copyRow(item);
        if (row) day[item.ingredientId] = row;
      });
      return day;
    }
    if (!value || typeof value !== "object") return {};
    Object.keys(value).forEach(function (id) {
      if (!isId(id)) return;
      const row = copyRow(value[id]);
      if (row) day[id] = row;
    });
    return day;
  }

  function mergeDay(primary, extra) {
    return Object.assign({}, extra || {}, primary || {});
  }

  // 本機紀錄的正式形狀是 { "YYYY-MM-DD": { "原料 id": { choice, note, updatedAt } } }，
  // 一次保存所有日期。舊資料若把某一天存成陣列、或整包是單日匯出檔，在這裡折回同一形狀，不丟已有的票。
  function normalizeStored(raw) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    const next = {};
    let recognized = false;
    Object.keys(raw).forEach(function (key) {
      if (!isDate(key)) return;
      const day = dayFrom(raw[key]);
      if (Object.keys(day).length) {
        next[key] = day;
        recognized = true;
      }
    });
    if (raw.kind === "ingredient-scout-votes" && isDate(raw.date) && Array.isArray(raw.votes)) {
      const imported = dayFrom(raw.votes);
      if (Object.keys(imported).length) {
        next[raw.date] = mergeDay(next[raw.date], imported);
        recognized = true;
      }
    }
    if (recognized) return next;
    const keys = Object.keys(raw);
    if (!keys.length || !keys.every(isId)) return raw;
    const grouped = {};
    let dated = false;
    for (let i = 0; i < keys.length; i += 1) {
      const row = copyRow(raw[keys[i]]);
      if (!row) return raw;
      const stamp = String(row.updatedAt || "");
      const date = isDate(stamp.slice(0, 10)) ? stamp.slice(0, 10) : "";
      if (!date) return raw;
      if (!grouped[date]) grouped[date] = {};
      grouped[date][keys[i]] = row;
      dated = true;
    }
    return dated ? grouped : raw;
  }

  function storedNeedsMigration(raw) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
    if (raw.kind === "ingredient-scout-votes" && Array.isArray(raw.votes)) return true;
    const keys = Object.keys(raw);
    if (!keys.length) return false;
    if (keys.every(isDate)) return keys.some(function (key) { return Array.isArray(raw[key]); });
    if (keys.every(isId)) {
      return keys.every(function (key) {
        const row = copyRow(raw[key]);
        return row && isDate(String(row.updatedAt || "").slice(0, 10));
      });
    }
    return false;
  }

  function myVotes(state, choice) {
    if (choice !== "approve" && choice !== "oppose") return [];
    const rows = [];
    if (!state || typeof state !== "object" || Array.isArray(state)) return rows;
    Object.keys(state).forEach(function (date) {
      if (!isDate(date)) return;
      const day = state[date];
      if (!day || typeof day !== "object" || Array.isArray(day)) return;
      Object.keys(day).forEach(function (id) {
        if (!isId(id)) return;
        const row = day[id];
        if (!row || row.choice !== choice) return;
        rows.push({
          date: date,
          ingredientId: id,
          choice: choice,
          note: normalizeNote(row.note).trim(),
          updatedAt: typeof row.updatedAt === "string" ? row.updatedAt : ""
        });
      });
    });
    rows.sort(function (a, b) {
      if (a.date !== b.date) return a.date < b.date ? 1 : -1;
      if (a.updatedAt !== b.updatedAt) return a.updatedAt < b.updatedAt ? 1 : -1;
      return a.ingredientId < b.ingredientId ? -1 : a.ingredientId > b.ingredientId ? 1 : 0;
    });
    return rows;
  }

  return {
    CHOICES: CHOICES,
    cast: cast,
    setNote: setNote,
    clearDate: clearDate,
    tally: tally,
    toDump: toDump,
    parseDump: parseDump,
    encodeShare: encodeShare,
    decodeShare: decodeShare,
    mergeDumps: mergeDumps,
    summaryDocument: summaryDocument,
    normalizeNote: normalizeNote,
    normalizeStored: normalizeStored,
    storedNeedsMigration: storedNeedsMigration,
    myVotes: myVotes
  };
});

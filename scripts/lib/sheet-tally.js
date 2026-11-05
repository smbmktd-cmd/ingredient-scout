/* 試算表計票的純函式。node 測試與 optional/google-apps-script/Code.gs 共用標記區塊。 */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.SheetTally = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  // tally-logic:start
  var SHEET_HEADERS = ["receivedAt", "ballotId", "date", "ingredientId", "choice", "note"];
  var BALLOT_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  var INGREDIENT_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
  var FORBIDDEN_KEYS = ["name", "email", "user", "username", "login", "ip", "phone", "author", "scoutname"];

  function forbiddenKeyMap() {
    var map = Object.create(null);
    var i;
    for (i = 0; i < FORBIDDEN_KEYS.length; i++) map[FORBIDDEN_KEYS[i]] = true;
    return map;
  }

  function cellToString(value) {
    if (value == null) return "";
    if (Object.prototype.toString.call(value) === "[object Date]" && !isNaN(value.getTime())) {
      return value.toISOString();
    }
    return String(value);
  }

  function normalizeSheetNote(note) {
    return String(note == null ? "" : note).replace(/\u0000/g, "").trim().slice(0, 1000);
  }

  function isIsoDate(value) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    var parts = value.split("-");
    var year = Number(parts[0]);
    var month = Number(parts[1]);
    var day = Number(parts[2]);
    var date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  }

  function isIngredientId(value) {
    return typeof value === "string" && value.length <= 80 && INGREDIENT_PATTERN.test(value);
  }

  function isBallotId(value) {
    return typeof value === "string" && BALLOT_PATTERN.test(value);
  }

  function assertNoIdentity(value, forbidden) {
    var tag = Object.prototype.toString.call(value);
    var i;
    var keys;
    if (tag === "[object Array]") {
      for (i = 0; i < value.length; i++) assertNoIdentity(value[i], forbidden);
      return;
    }
    if (!value || typeof value !== "object") return;
    keys = Object.keys(value);
    for (i = 0; i < keys.length; i++) {
      if (forbidden[String(keys[i]).toLowerCase()]) throw new Error("identity");
      assertNoIdentity(value[keys[i]], forbidden);
    }
  }

  function trimHeaderCells(headers) {
    var copy = [];
    var i;
    for (i = 0; i < headers.length; i++) copy.push(cellToString(headers[i]).trim());
    while (copy.length && copy[copy.length - 1] === "") copy.pop();
    return copy;
  }

  function headersEqual(left, right) {
    var i;
    if (left.length !== right.length) return false;
    for (i = 0; i < left.length; i++) if (left[i] !== right[i]) return false;
    return true;
  }

  function headerMigration(headers) {
    var norm = trimHeaderCells(headers || []);
    if (!norm.length) return { action: "write" };
    if (headersEqual(norm, SHEET_HEADERS)) return { action: "ready" };
    if (headersEqual(norm, ["receivedAt", "date", "ingredientId", "choice", "note"])) {
      return { action: "insertBallotId" };
    }
    return { action: "unknown" };
  }

  function migrateLegacyValues(values) {
    var headerRow = values && values.length ? values[0] : [];
    var plan = headerMigration(headerRow);
    var next;
    var i;
    var line;
    if (plan.action !== "insertBallotId") return { action: plan.action, values: values || [] };
    next = [SHEET_HEADERS.slice()];
    for (i = 1; i < values.length; i++) {
      line = values[i] || [];
      next.push([
        cellToString(line[0]),
        "",
        cellToString(line[1]),
        cellToString(line[2]),
        cellToString(line[3]),
        cellToString(line[4])
      ]);
    }
    return { action: "insertBallotId", values: next };
  }

  function rowsFromSheetValues(values) {
    var headers = [];
    var rows = [];
    var i;
    var col;
    var line;
    var blank;
    var obj;
    if (!values || !values.length) return { headers: [], rows: [] };
    for (i = 0; i < values[0].length; i++) headers.push(cellToString(values[0][i]).trim());
    for (i = 1; i < values.length; i++) {
      line = values[i] || [];
      blank = true;
      for (col = 0; col < headers.length; col++) {
        if (cellToString(line[col]).trim() !== "") blank = false;
      }
      if (blank) continue;
      obj = Object.create(null);
      for (col = 0; col < headers.length; col++) {
        if (headers[col] === "__proto__" || headers[col] === "prototype" || headers[col] === "constructor") continue;
        obj[headers[col]] = cellToString(line[col]);
      }
      rows.push({
        receivedAt: obj.receivedAt || "",
        ballotId: String(obj.ballotId || "").trim().toLowerCase(),
        date: String(obj.date || "").trim(),
        ingredientId: String(obj.ingredientId || "").trim(),
        choice: String(obj.choice || "").trim(),
        note: obj.note == null ? "" : String(obj.note)
      });
    }
    return { headers: headers, rows: rows };
  }

  function sheetValuesFromRows(rows) {
    var values = [SHEET_HEADERS.slice()];
    var i;
    var c;
    var row;
    var line;
    var key;
    for (i = 0; i < rows.length; i++) {
      row = rows[i];
      line = [];
      for (c = 0; c < SHEET_HEADERS.length; c++) {
        key = SHEET_HEADERS[c];
        line.push(row[key] == null ? "" : String(row[key]));
      }
      values.push(line);
    }
    return values;
  }

  function copyRow(row) {
    return {
      receivedAt: row.receivedAt || "",
      ballotId: row.ballotId || "",
      date: row.date || "",
      ingredientId: row.ingredientId || "",
      choice: row.choice || "",
      note: row.note || ""
    };
  }

  function parseBallotPost(data) {
    var forbidden = forbiddenKeyMap();
    var votes = [];
    var seen = Object.create(null);
    var i;
    var vote;
    var note;
    var choice;
    var ballotId;
    if (!data || typeof data !== "object" || Object.prototype.toString.call(data) === "[object Array]") {
      throw new Error("kind");
    }
    assertNoIdentity(data, forbidden);
    if (data.kind !== "ingredient-scout-votes") throw new Error("kind");
    if (!isIsoDate(data.date)) throw new Error("date");
    if (!isBallotId(data.ballotId)) throw new Error("ballot");
    ballotId = String(data.ballotId).toLowerCase();
    if (Object.prototype.toString.call(data.votes) !== "[object Array]" || data.votes.length > 50) {
      throw new Error("votes");
    }
    for (i = 0; i < data.votes.length; i++) {
      vote = data.votes[i];
      if (!vote || typeof vote !== "object" || Object.prototype.toString.call(vote) === "[object Array]") {
        throw new Error("votes");
      }
      if (!isIngredientId(vote.ingredientId)) throw new Error("ingredient");
      if (seen[vote.ingredientId]) throw new Error("ingredient");
      seen[vote.ingredientId] = true;
      choice = typeof vote.choice === "string" ? vote.choice.trim() : "";
      if (choice !== "approve" && choice !== "oppose") throw new Error("choice");
      if (vote.note != null && typeof vote.note !== "string") throw new Error("note");
      note = normalizeSheetNote(vote.note);
      votes.push({ ingredientId: vote.ingredientId, choice: choice, note: note });
    }
    return { ballotId: ballotId, date: data.date, votes: votes };
  }

  function buildCloudBallot(date, ballotId, votes) {
    return {
      kind: "ingredient-scout-votes",
      date: date,
      ballotId: ballotId,
      votes: votes
    };
  }

  function upsertBallotRows(rows, ballot, receivedAt) {
    var next = [];
    var i;
    var row;
    var vote;
    for (i = 0; i < rows.length; i++) {
      row = rows[i];
      if (row.ballotId === ballot.ballotId && row.date === ballot.date) continue;
      next.push(copyRow(row));
    }
    for (i = 0; i < ballot.votes.length; i++) {
      vote = ballot.votes[i];
      next.push({
        receivedAt: receivedAt,
        ballotId: ballot.ballotId,
        date: ballot.date,
        ingredientId: vote.ingredientId,
        choice: vote.choice,
        note: vote.note
      });
    }
    return next;
  }

  function compareReceived(a, b) {
    var ta = Date.parse(a || "");
    var tb = Date.parse(b || "");
    var sa;
    var sb;
    if (isNaN(ta)) ta = 0;
    if (isNaN(tb)) tb = 0;
    if (ta !== tb) return ta - tb;
    sa = String(a || "");
    sb = String(b || "");
    if (sa === sb) return 0;
    return sa > sb ? 1 : -1;
  }

  function tallySheetRows(rows, date) {
    var latest = Object.create(null);
    var latestOrder = [];
    var grouped = Object.create(null);
    var ballotSet = Object.create(null);
    var ids = [];
    var results = [];
    var ballotCount = 0;
    var i;
    var j;
    var row;
    var ballotId;
    var key;
    var prev;
    var winner;
    var list;
    var approve;
    var oppose;
    var notes;
    for (i = 0; i < rows.length; i++) {
      row = rows[i];
      if (!row || row.date !== date) continue;
      if (row.choice !== "approve" && row.choice !== "oppose") continue;
      if (!row.ingredientId) continue;
      // 舊版腳本沒有票號。每一列先各算一張票，避免整欄被丟掉；改票後的新列才有 ballotId。
      ballotId = row.ballotId ? String(row.ballotId) : "legacy:" + i;
      key = ballotId + "\n" + row.ingredientId;
      prev = latest[key];
      if (!prev) {
        latest[key] = { row: row, index: i };
        latestOrder.push(key);
      } else if (compareReceived(row.receivedAt, prev.row.receivedAt) >= 0) {
        latest[key] = { row: row, index: i };
      }
    }
    for (i = 0; i < latestOrder.length; i++) {
      winner = latest[latestOrder[i]].row;
      ballotId = latestOrder[i].split("\n")[0];
      if (!grouped[winner.ingredientId]) {
        grouped[winner.ingredientId] = [];
        ids.push(winner.ingredientId);
      }
      grouped[winner.ingredientId].push({
        ballotId: ballotId,
        choice: winner.choice,
        note: String(winner.note || "").trim()
      });
    }
    ids.sort();
    for (i = 0; i < ids.length; i++) {
      list = grouped[ids[i]];
      list.sort(function (a, b) {
        if (a.ballotId < b.ballotId) return -1;
        if (a.ballotId > b.ballotId) return 1;
        return 0;
      });
      approve = 0;
      oppose = 0;
      notes = [];
      for (j = 0; j < list.length; j++) {
        if (list[j].choice === "approve") approve += 1;
        if (list[j].choice === "oppose") oppose += 1;
        if (list[j].note) notes.push(list[j].note);
        if (!ballotSet[list[j].ballotId]) {
          ballotSet[list[j].ballotId] = true;
          ballotCount += 1;
        }
      }
      results.push({
        ingredientId: ids[i],
        approve: approve,
        oppose: oppose,
        notes: notes
      });
    }
    return { ok: true, date: date, ballots: ballotCount, results: results };
  }
  // tally-logic:end

  function gasRedirectAction(status, location) {
    var code = Number(status);
    if (code >= 300 && code < 400 && location) {
      return { action: "get-echo", url: String(location) };
    }
    return { action: "read" };
  }

  return {
    SHEET_HEADERS: SHEET_HEADERS,
    BALLOT_PATTERN: BALLOT_PATTERN,
    cellToString: cellToString,
    normalizeSheetNote: normalizeSheetNote,
    isIsoDate: isIsoDate,
    isIngredientId: isIngredientId,
    isBallotId: isBallotId,
    headerMigration: headerMigration,
    migrateLegacyValues: migrateLegacyValues,
    rowsFromSheetValues: rowsFromSheetValues,
    sheetValuesFromRows: sheetValuesFromRows,
    parseBallotPost: parseBallotPost,
    buildCloudBallot: buildCloudBallot,
    upsertBallotRows: upsertBallotRows,
    tallySheetRows: tallySheetRows,
    gasRedirectAction: gasRedirectAction
  };
});

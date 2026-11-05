/**
 * 匿名投票的試算表收集端，也是頁面上「團隊累計」的來源。
 * 不讀帳號、信箱或 IP。ballotId 是瀏覽器自己產生的隨機票號，不是姓名。
 *
 * 部署（從試算表建立，不要另開獨立指令碼）
 * 1. 建立空白 Google 試算表。第一列可留空，腳本會寫上
 *    receivedAt、ballotId、date、ingredientId、choice、note。
 * 2. 擴充功能 → Apps Script，貼上這個檔案（含下方 tally-logic 區塊）。
 *    儲存。這份腳本必須綁在試算表上，getActiveSpreadsheet() 才找得到表。
 * 3. 部署 → 新增部署 → 類型選「網頁應用程式」。
 * 4. 執行身分選「我」。存取權選「任何人」。
 *    不要選「任何人（Google 帳戶）」，否則同事會被導去登入，頁面讀不到計票。
 * 5. 授權後複製以 /exec 結尾的網址，貼到 docs/config.js 的 tallyEndpoint。
 *    sheetEndpoint 是同一個網址的別名，兩個都填時以 tallyEndpoint 為準。
 * 6. 用瀏覽器打開「網址?date=2026-11-05」。應看到 JSON，
 *    例如 {"ok":true,"date":"2026-11-05","ballots":0,"results":[]}，而不是登入頁。
 * 7. 以後改了這份程式：部署 → 管理部署 → 鉛筆 → 版本選「新版本」→ 部署。
 *    這樣網址不變。若改按「新增部署」，網址會換，config 也要一起換。
 *
 * 頁面怎麼呼叫
 * - POST 同一支網址。本文是 JSON：
 *   {kind:"ingredient-scout-votes", date, ballotId, votes:[{ingredientId, choice, note}]}
 *   votes 是這張票在這一天的完整內容，不是增量。同一 (ballotId, date, ingredientId)
 *   會覆寫，不再一直追加。這次沒帶的原料會從這張票拿掉，清除當日表態才會從累計消失。
 * - GET「網址?date=YYYY-MM-DD」回傳
 *   {ok:true, date, ballots, results:[{ingredientId, approve, oppose, notes:[]}]}
 *   同一張票對同一原料只算 receivedAt 最新的那一列。回應不含 ballotId。
 *   date 欄以純文字 YYYY-MM-DD 存放。若試算表已把該欄存成日期，讀回時用試算表時區
 *   （沒有則 Asia/Taipei）的 Utilities.formatDate 轉回日曆日，不用 toISOString。
 *   台北午夜若走 toISOString 會變成前一天，整日的票會被濾掉，團隊累計就會一直是 0。
 *   receivedAt 仍是 ISO 時間。
 *
 * 跨網域（GitHub Pages 的瀏覽器會直接打這支網址）
 * ContentService 不能自訂 Access-Control-Allow-Origin。實際可用的做法是：
 * 1. 存取權必須是「任何人」，最終的 googleusercontent 回應才會讓匿名網頁讀到。
 * 2. POST 的 Content-Type 用 text/plain;charset=utf-8，不要用 application/json。
 *    application/json 會先送 OPTIONS 預檢，Apps Script 沒有 doOptions，預檢會失敗。
 * 3. 網頁應用程式對 POST 與 GET 都先回 302，Location 在
 *    script.googleusercontent.com/macros/echo。那次 302 與 echo 回應都會帶
 *    Access-Control-Allow-Origin: *（這是 Google 加的，ContentService 自己設不了）。
 *    瀏覽器要做的是：用 text/plain POST，並跟隨轉址，改以 GET 讀 echo 的 JSON。
 *    不要對 echo 網址再 POST，也不要在跟隨的 GET 上留下 Content-Type，否則會拿到
 *    一段 HTML 錯誤頁，而不是 JSON。投票頁若自己看到 302 與 Location，會改發 GET。
 * 4. 若瀏覽器仍讀不到回應，投票頁會改以 no-cors 再送一次（送得出去，但讀不到 JSON），
 *    GET 則改帶 callback。此時回傳 JSONP
 *    （ContentService 的 JAVASCRIPT），用來避開轉址的跨域限制。
 *    callback 只接受簡短的函式名，避免把備註拼進可執行的程式。
 * 5. 舊版五欄（沒有 ballotId）會在第一次 POST 時自動插入 ballotId 欄。
 *    那些舊列沒有票號，計票時每一列先各算一張，以免整批被丟掉。
 *
 * Formspree 不經過這支腳本。信件備份由投票頁另外送，試算表仍是頁面計票的來源。
 */
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

  function isDateObject(value) {
    return Object.prototype.toString.call(value) === "[object Date]" && !isNaN(value.getTime());
  }

  function cellToString(value) {
    if (value == null) return "";
    if (isDateObject(value)) return value.toISOString();
    return String(value);
  }

  function sheetTimeZone() {
    var zone = "Asia/Taipei";
    var ss;
    var tz;
    try {
      if (typeof SpreadsheetApp !== "undefined" && SpreadsheetApp.getActiveSpreadsheet) {
        ss = SpreadsheetApp.getActiveSpreadsheet();
        tz = ss && ss.getSpreadsheetTimeZone && ss.getSpreadsheetTimeZone();
        if (tz) return String(tz);
      }
    } catch (ignore) {}
    return zone;
  }

  function pad2(value) {
    var text = String(value);
    return text.length < 2 ? "0" + text : text;
  }

  function formatCalendarDayFixedOffset(value, hours) {
    var shifted = new Date(value.getTime() + hours * 60 * 60 * 1000);
    return shifted.getUTCFullYear() + "-" + pad2(shifted.getUTCMonth() + 1) + "-" + pad2(shifted.getUTCDate());
  }

  // node 沒有 Utilities。這裡用指定時區的日曆日當替身，不看行程時區，也不用 toISOString。
  function formatCalendarDayInZone(value, timeZone) {
    var parts;
    var map;
    var i;
    var year;
    var month;
    var day;
    try {
      parts = new Intl.DateTimeFormat("en-US", {
        timeZone: timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
      }).formatToParts(value);
      map = Object.create(null);
      for (i = 0; i < parts.length; i++) {
        if (parts[i].type === "year" || parts[i].type === "month" || parts[i].type === "day") {
          map[parts[i].type] = parts[i].value;
        }
      }
      year = map.year;
      month = map.month;
      day = map.day;
      if (year && month && day) return year + "-" + pad2(month) + "-" + pad2(day);
    } catch (ignore) {}
    if (timeZone === "Asia/Taipei") return formatCalendarDayFixedOffset(value, 8);
    return "";
  }

  // 試算表常把 "YYYY-MM-DD" 存成日期。getValues() 的 Date 是該時區的午夜，
  // toISOString() 在台北會落到前一天。日曆日要用試算表時區，不用 UTC。
  function calendarDateString(value, timeZone) {
    var zone;
    var formatted;
    if (value == null || value === "") return "";
    if (!isDateObject(value)) return String(value).trim();
    zone = timeZone || sheetTimeZone();
    if (typeof Utilities !== "undefined" && Utilities.formatDate) {
      try {
        formatted = Utilities.formatDate(value, zone, "yyyy-MM-dd");
        if (formatted) return String(formatted);
      } catch (ignore) {}
    }
    return formatCalendarDayInZone(value, zone);
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
    var zone;
    if (plan.action !== "insertBallotId") return { action: plan.action, values: values || [] };
    zone = sheetTimeZone();
    next = [SHEET_HEADERS.slice()];
    for (i = 1; i < values.length; i++) {
      line = values[i] || [];
      next.push([
        cellToString(line[0]),
        "",
        calendarDateString(line[1], zone),
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
    var zone;
    if (!values || !values.length) return { headers: [], rows: [] };
    zone = sheetTimeZone();
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
        if (headers[col] === "date") obj[headers[col]] = calendarDateString(line[col], zone);
        else obj[headers[col]] = cellToString(line[col]);
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

var KNOWN_ERRORS = {
  kind: true,
  date: true,
  ballot: true,
  votes: true,
  choice: true,
  ingredient: true,
  note: true,
  identity: true,
  headers: true,
  sheet: true
};

function doGet(e) {
  var params = e && e.parameter ? e.parameter : {};
  try {
    var date = String(params.date || "");
    if (!isIsoDate(date)) return respond_(params, { ok: false, error: "date" });
    var rows = readRows_();
    return respond_(params, tallySheetRows(rows, date));
  } catch (err) {
    return respond_(params, failure_(err));
  }
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  var held = false;
  try {
    var raw = e && e.postData && e.postData.contents ? e.postData.contents : "";
    var ballot = parseBallotPost(JSON.parse(raw));
    lock.waitLock(20000);
    held = true;
    var loaded = loadSheetRows_();
    if (!loaded.ok) return json_(failure_(new Error(loaded.error || "headers")));
    var next = upsertBallotRows(loaded.rows, ballot, new Date().toISOString());
    writeValues_(loaded.sheet, sheetValuesFromRows(next));
    return json_({ ok: true, date: ballot.date, stored: ballot.votes.length });
  } catch (err) {
    return json_(failure_(err));
  } finally {
    if (held) {
      try {
        lock.releaseLock();
      } catch (ignore) {}
    }
  }
}

function spreadsheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error("sheet");
  var sheet = ss.getSheets()[0];
  if (!sheet) throw new Error("sheet");
  return sheet;
}

function readRows_() {
  var sheet = spreadsheet_();
  if (!sheet.getLastRow()) return [];
  var values = sheet.getRange(1, 1, sheet.getLastRow(), Math.max(sheet.getLastColumn(), 1)).getValues();
  return rowsFromSheetValues(values).rows;
}

function loadSheetRows_() {
  var sheet = spreadsheet_();
  var raw = sheet.getLastRow()
    ? sheet.getRange(1, 1, sheet.getLastRow(), Math.max(sheet.getLastColumn(), 1)).getValues()
    : [];
  var migrated = migrateLegacyValues(raw);
  if (migrated.action === "unknown") return { ok: false, error: "headers", sheet: sheet };
  var values = raw;
  if (migrated.action === "write") {
    values = [SHEET_HEADERS.slice()];
    writeValues_(sheet, values);
  } else if (migrated.action === "insertBallotId") {
    values = migrated.values;
    writeValues_(sheet, values);
  }
  return { ok: true, sheet: sheet, rows: rowsFromSheetValues(values).rows };
}

function writeValues_(sheet, values) {
  var rows = values.length;
  var cols = SHEET_HEADERS.length;
  var lastRow = sheet.getLastRow();
  var dateCol = SHEET_HEADERS.indexOf("date") + 1;
  var height;
  if (lastRow > rows) {
    sheet.getRange(rows + 1, 1, lastRow - rows, cols).clearContent();
  }
  // 格式要在 setValues 之前設成純文字。寫入後再設只改顯示，格子裡仍是 Date。
  if (dateCol > 0) {
    height = Math.max(sheet.getMaxRows(), rows);
    sheet.getRange(1, dateCol, height, 1).setNumberFormat("@");
  }
  sheet.getRange(1, 1, rows, cols).setValues(values);
}

function failure_(err) {
  var code = err && err.message ? String(err.message) : "";
  if (KNOWN_ERRORS[code]) return { ok: false, error: code };
  return { ok: false };
}

function respond_(params, obj) {
  var body = JSON.stringify(obj);
  var callback = params && typeof params.callback === "string" ? params.callback : "";
  if (/^[A-Za-z_$][A-Za-z0-9_$]{0,40}$/.test(callback)) {
    return ContentService
      .createTextOutput(callback + "(" + body + ");")
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return json_(obj);
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { buildCatalog, loadRaw, readJson, serializeCatalog } from "./lib/catalog.mjs";

const require = createRequire(import.meta.url);
const VoteModel = require("../docs/vote-model.js");
const SheetTally = require("./lib/sheet-tally.js");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const schema = readJson(path.join(root, "data", "schema.json"));
const errors = [];

function fail(message) {
  errors.push(message);
}

function getPath(obj, dotted) {
  return dotted.split(".").reduce((value, key) => (value == null ? undefined : value[key]), obj);
}

function isDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function walkKeys(value, visit) {
  if (Array.isArray(value)) {
    value.forEach((item) => walkKeys(item, visit));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const key of Object.keys(value)) {
    visit(key);
    walkKeys(value[key], visit);
  }
}

const forbiddenKeys = new Set(["email", "phone", "scoutname", "authoremail", "ip"]);
const idPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const exampleHosts = new Set(["example.com", "www.example.com"]);

function hostOf(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

function checkIngredient(entry) {
  const data = entry.data;
  const where = "data/ingredients/" + entry.file;
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    fail(where + " 不是物件");
    return;
  }
  walkKeys(data, (key) => {
    if (forbiddenKeys.has(key.toLowerCase())) fail(where + " 含有不該出現的欄位 " + key);
  });
  for (const dotted of schema.ingredientRequired) {
    const value = getPath(data, dotted);
    if (value === undefined || value === null || value === "") {
      fail(where + " 缺少 " + dotted);
    }
  }
  if (!idPattern.test(data.id || "")) fail(where + " 的 id 需為小寫英文與連字號");
  const expectedFile = data.id + ".json";
  if (entry.file !== expectedFile) fail(where + " 檔名應為 " + expectedFile);
  if (typeof data.example !== "boolean") fail(where + " 的 example 需為布林值");
  if (!schema.enums["supply.relationship"].includes(data.supply?.relationship)) {
    fail(where + " 的供應關係不在清單內");
  }
  if (
    ["taiwan_agent", "taiwan_distributor"].includes(data.supply?.relationship) &&
    !String(data.supply?.taiwanPartyName || "").trim()
  ) {
    fail(where + " 標成代理或經銷時，要填台灣關聯廠商名稱");
  }
  if (!schema.enums["tfda.usable"].includes(data.tfda?.usable)) fail(where + " 的 TFDA 狀態不在清單內");
  if (!isDate(data.tfda?.lookupDate)) fail(where + " 的 lookupDate 不是有效日期");
  if (!String(data.tfda?.lookupToolUrl || "").startsWith("https://yoyosu890524-byte.github.io/tfda-lookup")) {
    fail(where + " 的查詢工具網址應指向 TFDA 查詢助手");
  }
  const cross = data.tfda?.officialCrosscheck || {};
  if (cross.ingredientPlatformUrl !== "https://consumer.fda.gov.tw/Food/Material.aspx?nodeID=160") {
    fail(where + " 的原料官方頁網址被改掉了");
  }
  if (cross.additiveListUrl !== "https://consumer.fda.gov.tw/Law/FoodAdditivesList.aspx?nodeID=521") {
    fail(where + " 的添加物官方頁網址被改掉了");
  }
  if (typeof cross.done !== "boolean") fail(where + " 的 officialCrosscheck.done 需為布林值");
  if (
    ["listed_food_ingredient", "listed_food_additive", "unconfirmed_not_for_food_use"].includes(data.tfda?.usable) &&
    cross.done !== true
  ) {
    fail(where + " 已做成列名或未確認的結論時，官方頁交叉核對要標完成");
  }
  if (!Array.isArray(data.tfda?.queries) || data.tfda.queries.length < 1) {
    fail(where + " 至少要有一筆查詢紀錄");
  } else {
    for (const query of data.tfda.queries) {
      if (!schema.enums["tfda.queryTab"].includes(query.tab)) fail(where + " 的查詢分頁不正確");
      if (typeof query.keyword !== "string") fail(where + " 的查詢關鍵字需為文字");
      if (!(query.resultCount === null || Number.isInteger(query.resultCount))) {
        fail(where + " 的筆數需為整數或 null");
      }
      if (typeof query.unconfirmedSafety !== "boolean") fail(where + " 的 unconfirmedSafety 需為布林值");
    }
  }
  if (!schema.enums["discovery.channel"].includes(data.discovery?.channel)) {
    fail(where + " 的偵察管道不在清單內");
  }
  if (!isDate(data.discovery?.scoutDate)) fail(where + " 的 scoutDate 不是有效日期");
  if (!schema.enums["patent.status"].includes(data.patent?.status)) fail(where + " 的專利狀態不正確");
  if (!schema.enums["literature.status"].includes(data.literature?.status)) fail(where + " 的文獻狀態不正確");
  if (data.patent?.status === "yes" && (!Array.isArray(data.patent.refs) || data.patent.refs.length < 1)) {
    fail(where + " 標成有專利時要附出處");
  }
  if (data.literature?.status === "yes" && (!Array.isArray(data.literature.refs) || data.literature.refs.length < 1)) {
    fail(where + " 標成有文獻時要附出處");
  }
  if (!Array.isArray(data.evidenceLevels)) fail(where + " 的證據等級需為陣列");
  else {
    const seen = new Set();
    for (const level of data.evidenceLevels) {
      if (!schema.enums.evidenceLevels.includes(level)) fail(where + " 的證據等級不在清單內：" + level);
      if (seen.has(level)) fail(where + " 的證據等級重複");
      seen.add(level);
    }
    if (data.evidenceLevels.includes("clinical") && data.literature?.status !== "yes") {
      fail(where + " 標了臨床證據時，文獻狀態要是 yes 並附出處");
    }
  }
  if (!Array.isArray(data.efficacy?.claimedBenefits) || data.efficacy.claimedBenefits.length < 1) {
    fail(where + " 至少要有一則效益敘述");
  }
  if (!Array.isArray(data.sources) || data.sources.length < 2) fail(where + " 至少要兩個來源");
  else {
    for (const source of data.sources) {
      if (!source.title || !source.url || !source.whatItContributes) fail(where + " 的來源缺標題、網址或貢獻說明");
      if (!schema.enums["source.channel"].includes(source.channel)) fail(where + " 的來源管道不正確");
      if (!isDate(source.accessed)) fail(where + " 的來源讀取日不正確");
      if (!/^https?:\/\//.test(source.url || "")) fail(where + " 的來源網址需為 http(s)");
    }
  }
  if (!Array.isArray(data.images)) fail(where + " 的圖片需為陣列");
  else {
    for (const image of data.images) {
      if (!schema.enums["image.source"].includes(image.source)) fail(where + " 的圖片來源類型不正確");
      if (image.url && !/^https?:\/\//.test(image.url)) fail(where + " 的圖片網址需為 http(s)");
      if (image.localPath && !/^assets\/[A-Za-z0-9._/-]+$/.test(image.localPath)) {
        fail(where + " 的本地圖片路徑需放在 docs/assets 並寫成 assets/...");
      }
      if (image.localPath && !fs.existsSync(path.join(root, "docs", image.localPath))) {
        fail(where + " 找不到本地圖片 " + image.localPath);
      }
    }
  }
  if (data.example === true) {
    if (data.tfda?.usable !== "example_only") fail(where + " 是範例，TFDA 狀態必須是 example_only");
    for (const text of [
      data.names?.commonZh,
      data.names?.trade,
      data.names?.scientific,
      data.efficacy?.suggestedDosage,
      ...(data.efficacy?.claimedBenefits || [])
    ]) {
      if (!String(text || "").includes("虛構")) fail(where + " 的範例文字要標明虛構：" + text);
    }
    for (const source of data.sources || []) {
      if (!exampleHosts.has(hostOf(source.url))) fail(where + " 的範例來源只能用 example.com：" + source.url);
    }
    for (const image of data.images || []) {
      if (image.url && !exampleHosts.has(hostOf(image.url))) {
        fail(where + " 的範例圖片網址只能用 example.com");
      }
    }
  }
}

function checkDay(entry, ingredientsById) {
  const data = entry.data;
  const where = "data/days/" + entry.file;
  if (!isDate(data.date)) fail(where + " 的日期無效");
  if (entry.file !== data.date + ".json") fail(where + " 檔名需與日期相同");
  if (typeof data.example !== "boolean") fail(where + " 的 example 需為布林值");
  if (!Array.isArray(data.picks) || data.picks.length < 1) fail(where + " 沒有原料");
  if (data.example === false && data.picks?.length !== 5) {
    fail(where + " 正式日報要剛好 5 筆原料");
  }
  const seen = new Set();
  for (const id of data.picks || []) {
    if (seen.has(id)) fail(where + " 重複引用 " + id);
    seen.add(id);
    const ingredient = ingredientsById.get(id);
    if (!ingredient) fail(where + " 找不到原料 " + id);
    else if (data.example === false && ingredient.example === true) {
      fail(where + " 正式日報不能放虛構範例 " + id);
    } else if (data.example === true && ingredient.example !== true) {
      fail(where + " 範例日報只能放虛構原料 " + id);
    }
  }
  for (const channel of data.channelsCovered || []) {
    if (!schema.enums["discovery.channel"].includes(channel)) fail(where + " 的管道標記不正確");
  }
  walkKeys(data, (key) => {
    if (forbiddenKeys.has(key.toLowerCase())) fail(where + " 含有不該出現的欄位 " + key);
  });
}

function checkDocs() {
  const readme = fs.readFileSync(path.join(root, "README.md"), "utf8");
  for (const needle of [
    "yoyosu890524-byte.github.io/tfda-lookup",
    "GitHub Pages",
    "贊成",
    "範本",
    "docs/"
  ]) {
    if (!readme.includes(needle)) fail("README.md 缺少說明：" + needle);
  }
  const dossier = fs.readFileSync(path.join(root, "templates", "ingredient-dossier.md"), "utf8");
  for (const needle of ["TFDA", "專利", "文獻", "劑量", "來源", "虛構"]) {
    if (!dossier.includes(needle)) fail("卷宗範本缺少：" + needle);
  }
  const html = fs.readFileSync(path.join(root, "docs", "index.html"), "utf8");
  for (const needle of ["catalog.js", "vote-model.js", "app.js", "styles.css", "config.js", "zh-Hant"]) {
    if (!html.includes(needle)) fail("投票頁缺少：" + needle);
  }
  const app = fs.readFileSync(path.join(root, "docs", "app.js"), "utf8");
  for (const key of [
    ...schema.enums["tfda.usable"],
    ...schema.enums["discovery.channel"],
    ...schema.enums["supply.relationship"]
  ]) {
    if (!app.includes(key)) fail("投票頁缺少狀態碼 " + key);
  }
  if (!fs.existsSync(path.join(root, "LICENSE"))) fail("缺少 LICENSE");
  if (!fs.existsSync(path.join(root, "CONTRIBUTING.md"))) fail("缺少 CONTRIBUTING.md");
  const config = fs.readFileSync(path.join(root, "docs", "config.js"), "utf8");
  if (!/formspreeEndpoint:\s*"https:\/\/formspree\.io\/f\/(?!xxxxxxxx")[a-z0-9]+"/.test(config)) {
    fail("formspreeEndpoint 應為已建立的 Formspree https 端點");
  }
  if (!/tallyEndpoint:\s*"https:\/\/script\.google\.com\/macros\/s\/(?!xxxxxxxx\/)[A-Za-z0-9_-]+\/exec"/.test(config)) {
    fail("tallyEndpoint 應為已部署的 Apps Script https 端點");
  }
  if (!/sheetEndpoint:\s*""/.test(config)) fail("sheetEndpoint 應保持空白");
  if (!/submitEndpoint:\s*""/.test(config)) fail("submitEndpoint 應保持空白");
  for (const needle of ["team-panel", "team-summary", "dock-team", "sync-note"]) {
    if (!html.includes(needle)) fail("投票頁缺少：" + needle);
  }
  if (html.includes("知道連結就能表態") || html.includes("不索取姓名")) {
    fail("投票頁不應再顯示頁首那句表態說明");
  }
  if (app.includes("day-note") || /banner\.append\([\s\S]{0,80}day\.notes/.test(app)) {
    fail("投票頁不應再顯示日報 notes");
  }
  for (const needle of ["tallyEndpoint", "formspreeEndpoint", "text/plain;charset=utf-8", "團隊累計", "ballotId"]) {
    if (!app.includes(needle)) fail("投票頁腳本缺少：" + needle);
  }
}

function checkCatalog() {
  const catalog = buildCatalog(loadRaw(root));
  const files = serializeCatalog(catalog);
  const jsonPath = path.join(root, "docs", "catalog.json");
  const jsPath = path.join(root, "docs", "catalog.js");
  if (!fs.existsSync(jsonPath) || !fs.existsSync(jsPath)) {
    fail("尚未產生 docs/catalog.json。請執行 node scripts/build-catalog.mjs");
    return;
  }
  if (fs.readFileSync(jsonPath, "utf8") !== files.json || fs.readFileSync(jsPath, "utf8") !== files.js) {
    fail("docs/catalog.json 與資料不一致。請執行 node scripts/build-catalog.mjs");
  }
}

function assert(condition, message) {
  if (!condition) fail("投票邏輯：" + message);
}

function checkVoteModel() {
  const date = "2026-11-05";
  const ids = ["example-aurora-berry", "example-lumen-peptide"];
  let state = {};
  state = VoteModel.setNote(state, { date, ingredientId: ids[0], note: "  先寫備註  ", now: "2026-11-05T00:00:00.000Z" });
  state = VoteModel.cast(state, { date, ingredientId: ids[0], choice: "approve", now: "2026-11-05T00:01:00.000Z" });
  state = VoteModel.cast(state, { date, ingredientId: ids[0], choice: "approve", now: "2026-11-05T00:02:00.000Z" });
  state = VoteModel.cast(state, { date, ingredientId: ids[1], choice: "oppose", note: "劑量出處只有一份", now: "2026-11-05T00:03:00.000Z" });
  const dump = VoteModel.toDump(state, date, ids, "2026-11-05T00:04:00.000Z");
  assert(dump.votes.length === 2, "同一原料重複按贊成仍應只有一票");
  assert(dump.votes[0].note === "先寫備註", "先寫的備註要留到表態裡");
  assert(dump.votes[0].choice === "approve" && dump.votes[1].choice === "oppose", "贊成與反對都要留下");
  assert(dump.complete === true && dump.anonymous === true, "兩筆都表態時應標成完成且匿名");
  const tally = VoteModel.tally(state, date, ids);
  assert(tally.approve === 1 && tally.oppose === 1 && tally.voted === 2, "本機計數不對");
  const round = VoteModel.decodeShare(VoteModel.encodeShare(dump));
  assert(round.votes[1].note === "劑量出處只有一份", "分享碼要能還原備註");
  const other = VoteModel.parseDump(JSON.stringify({
    kind: "ingredient-scout-votes",
    version: 1,
    date,
    exportedAt: "2026-11-05T01:00:00.000Z",
    source: "browser-session",
    anonymous: true,
    votes: [{ ingredientId: ids[0], choice: "oppose", note: "", updatedAt: "2026-11-05T01:00:00.000Z" }]
  }));
  const merged = VoteModel.mergeDumps([dump, dump, other], ids, date);
  assert(merged.ballots === 2 && merged.duplicates === 1, "完全相同的檔案只能算一張票");
  assert(merged.results[0].approve === 1 && merged.results[0].oppose === 1, "彙總應同時計入贊成與反對");
  const long = VoteModel.normalizeNote("註".repeat(1200));
  assert(long.length === 1000, "備註應截斷在 1000 字");
  let rejected = false;
  try {
    VoteModel.parseDump({
      kind: "ingredient-scout-votes",
      version: 1,
      date,
      exportedAt: "2026-11-05T01:00:00.000Z",
      source: "browser-session",
      anonymous: true,
      email: "person@example.com",
      votes: []
    });
  } catch {
    rejected = true;
  }
  assert(rejected, "含有電子郵件的投票檔應被拒絕");
  let badChoice = false;
  try {
    VoteModel.cast({}, { date, ingredientId: ids[0], choice: "maybe" });
  } catch {
    badChoice = true;
  }
  assert(badChoice, "贊成與反對以外的值應被拒絕");
}

function assertSheet(condition, message) {
  if (!condition) fail("試算表計票：" + message);
}

function sheetError(fn) {
  try {
    fn();
  } catch (error) {
    return error.message;
  }
  return "";
}

function markedBlock(source) {
  const startToken = "// tally-logic:start";
  const endToken = "// tally-logic:end";
  const start = source.indexOf(startToken);
  const end = source.indexOf(endToken);
  if (start < 0 || end < start) return "";
  return source.slice(start + startToken.length, end).replace(/\r\n/g, "\n").trim();
}

function applySheetPost(values, body, receivedAt) {
  const migrated = SheetTally.migrateLegacyValues(values);
  let nextValues = values;
  if (migrated.action === "write") nextValues = [SheetTally.SHEET_HEADERS.slice()];
  else if (migrated.action === "insertBallotId") nextValues = migrated.values;
  else if (migrated.action === "unknown") throw new Error("headers");
  const rows = SheetTally.upsertBallotRows(
    SheetTally.rowsFromSheetValues(nextValues).rows,
    SheetTally.parseBallotPost(body),
    receivedAt
  );
  return SheetTally.sheetValuesFromRows(rows);
}

function checkSheetTally() {
  const lib = markedBlock(fs.readFileSync(path.join(root, "scripts", "lib", "sheet-tally.js"), "utf8"));
  const gas = markedBlock(fs.readFileSync(path.join(root, "optional", "google-apps-script", "Code.gs"), "utf8"));
  assertSheet(lib.length > 0 && lib === gas, "Code.gs 的計票區塊必須與 scripts/lib/sheet-tally.js 相同");
  const code = fs.readFileSync(path.join(root, "optional", "google-apps-script", "Code.gs"), "utf8");
  for (const needle of ["function doGet", "function doPost", "text/plain", "任何人", "JSONP", "ballotId"]) {
    assertSheet(code.includes(needle), "Code.gs 缺少：" + needle);
  }
  assertSheet(code.includes('setNumberFormat("@")'), "寫入前應把 date 欄設成純文字，避免 YYYY-MM-DD 被轉成 Date");
  assertSheet(code.includes("Utilities.formatDate"), "讀回 date 欄應使用 Utilities.formatDate，而不是 toISOString 當日曆日");
  const app = fs.readFileSync(path.join(root, "docs", "app.js"), "utf8");
  const ballotLiteral = app.match(/const BALLOT_RE = (\/\^\[0-9a-f\].*\/i);/);
  assertSheet(ballotLiteral, "投票頁應有與試算表相同的票號格式");
  const ballotRe = eval(ballotLiteral[1]);
  const first = "11111111-1111-4111-8111-111111111111";
  const second = "22222222-2222-4222-8222-222222222222";
  assertSheet(ballotRe.test(first) && SheetTally.isBallotId(first), "票號格式應接受 UUID");
  assertSheet(!SheetTally.isBallotId("person@example.com"), "票號不應接受信箱");
  assertSheet(sheetError(() => SheetTally.parseBallotPost({
    kind: "ingredient-scout-votes",
    date: "2026-11-05",
    ballotId: first,
    email: "person@example.com",
    votes: []
  })) === "identity", "含有電子郵件欄位的選票應被拒絕");
  assertSheet(sheetError(() => SheetTally.parseBallotPost({
    kind: "ingredient-scout-votes",
    date: "2026-02-31",
    ballotId: first,
    votes: []
  })) === "date", "不存在的日期應被拒絕");
  assertSheet(sheetError(() => SheetTally.parseBallotPost({
    kind: "other",
    date: "2026-11-05",
    ballotId: first,
    votes: []
  })) === "kind", "其他 kind 應被拒絕");

  const berry = "example-aurora-berry";
  const peptide = "example-lumen-peptide";
  const longNote = "註".repeat(1200);
  let values = applySheetPost([], {
    kind: "ingredient-scout-votes",
    date: "2026-11-05",
    ballotId: first.toUpperCase(),
    version: 1,
    votes: [
      { ingredientId: berry, choice: "approve", note: "  先觀察  ", updatedAt: "2026-11-05T00:00:00.000Z" },
      { ingredientId: peptide, choice: "oppose", note: longNote }
    ]
  }, "2026-11-05T00:00:00.000Z");
  let rows = SheetTally.rowsFromSheetValues(values).rows;
  assertSheet(rows.length === 2, "第一張票應寫入兩列");
  assertSheet(rows[0].ballotId === first && rows[0].note === "先觀察", "票號要轉成小寫，備註要去掉前後空白");
  assertSheet(rows[1].note.length === 1000, "備註應截斷在 1000 字");
  values = applySheetPost(values, {
    kind: "ingredient-scout-votes",
    date: "2026-11-05",
    ballotId: first,
    votes: [{ ingredientId: berry, choice: "oppose", note: "改票" }]
  }, "2026-11-05T01:00:00.000Z");
  rows = SheetTally.rowsFromSheetValues(values).rows;
  assertSheet(rows.length === 1 && rows[0].choice === "oppose" && rows[0].ingredientId === berry, "改票應覆寫，並拿掉這次沒再投的原料");
  values = applySheetPost(values, SheetTally.buildCloudBallot("2026-11-04", first, [
    { ingredientId: berry, choice: "approve", note: "" }
  ]), "2026-11-05T02:00:00.000Z");
  values = applySheetPost(values, SheetTally.buildCloudBallot("2026-11-05", second, [
    { ingredientId: berry, choice: "approve", note: "第二張" },
    { ingredientId: peptide, choice: "approve", note: "第二張" }
  ]), "2026-11-05T03:00:00.000Z");
  rows = SheetTally.rowsFromSheetValues(values).rows;
  assertSheet(rows.length === 4, "另一天與另一張票都要留下");
  const tally = SheetTally.tallySheetRows(rows, "2026-11-05");
  assertSheet(tally.ok === true && tally.ballots === 2, "同一天應有兩張匿名票");
  const berryRow = tally.results.find((row) => row.ingredientId === berry);
  const peptideRow = tally.results.find((row) => row.ingredientId === peptide);
  assertSheet(berryRow.approve === 1 && berryRow.oppose === 1, "同一原料的兩張票要各算一次");
  assertSheet(peptideRow.approve === 1 && peptideRow.oppose === 0, "沒再投的原料不應留下舊的反對");
  assertSheet(berryRow.notes.join(" / ") === "改票 / 第二張", "備註要來自每張票的最新選擇");
  assertSheet(!JSON.stringify(tally).includes(first) && !JSON.stringify(tally).includes(second), "公開計票不應含票號");
  const duplicated = rows.concat([{
    receivedAt: "2026-11-05T04:00:00.000Z",
    ballotId: second,
    date: "2026-11-05",
    ingredientId: berry,
    choice: "oppose",
    note: "較新的一列"
  }]);
  const latest = SheetTally.tallySheetRows(duplicated, "2026-11-05");
  const latestBerry = latest.results.find((row) => row.ingredientId === berry);
  assertSheet(latestBerry.approve === 0 && latestBerry.oppose === 2, "同一張票的重複列只算最新的選擇");
  assertSheet(latestBerry.notes.includes("較新的一列") && !latestBerry.notes.includes("第二張"), "舊備註不應和較新的一列一起計算");
  assertSheet(latest.ballots === 2, "重複列不應把同一張票算成兩張");
  const cleared = SheetTally.upsertBallotRows(rows, SheetTally.parseBallotPost(
    SheetTally.buildCloudBallot("2026-11-05", second, [])
  ), "2026-11-05T05:00:00.000Z");
  const afterClear = SheetTally.tallySheetRows(cleared, "2026-11-05");
  assertSheet(afterClear.ballots === 1 && afterClear.results.length === 1, "送出空票應從這一天拿掉該票號");
  const legacyValues = [
    ["receivedAt", "date", "ingredientId", "choice", "note", ""],
    ["2026-11-05T00:00:00.000Z", "2026-11-05", berry, "approve", "舊資料"],
    [new Date("2026-11-05T00:30:00.000Z"), "2026-11-05", peptide, "oppose", "日期物件"]
  ];
  assertSheet(SheetTally.headerMigration(legacyValues[0]).action === "insertBallotId", "舊版五欄應補上票號欄");
  const migrated = SheetTally.migrateLegacyValues(legacyValues);
  const legacyRows = SheetTally.rowsFromSheetValues(migrated.values).rows;
  assertSheet(legacyRows[0].ballotId === "" && legacyRows[1].receivedAt === "2026-11-05T00:30:00.000Z", "舊列遷移後要保留內容，並把日期儲存格轉成文字");
  const legacyTally = SheetTally.tallySheetRows(legacyRows, "2026-11-05");
  assertSheet(legacyTally.ballots === 2 && legacyTally.results[0].approve === 1, "沒有票號的舊列仍要各自計入");
  const taipeiMidnight = new Date("2026-11-04T16:00:00.000Z");
  const marchFirst = new Date("2026-02-28T16:00:00.000Z");
  assertSheet(taipeiMidnight.toISOString().slice(0, 10) === "2026-11-04", "這個 Date 的 toISOString 日曆日落在前一天，用來抓住時區錯位");
  const dateObjectValues = [
    ["receivedAt", "ballotId", "date", "ingredientId", "choice", "note"],
    [new Date("2026-11-05T01:23:45.000Z"), first, taipeiMidnight, berry, "approve", "日曆日"],
    ["2026-11-05T02:00:00.000Z", second, "2026-11-05", peptide, "oppose", "仍是文字"]
  ];
  const dateObjectRows = SheetTally.rowsFromSheetValues(dateObjectValues).rows;
  assertSheet(dateObjectRows[0].date === "2026-11-05", "試算表把 date 存成 Date 時，讀回應是 Asia/Taipei 的 YYYY-MM-DD");
  assertSheet(dateObjectRows[0].receivedAt === "2026-11-05T01:23:45.000Z", "receivedAt 的 Date 仍轉成 ISO，不改成日曆日");
  assertSheet(dateObjectRows[1].date === "2026-11-05", "本來就是文字的 date 維持 YYYY-MM-DD");
  const dateObjectTally = SheetTally.tallySheetRows(dateObjectRows, "2026-11-05");
  assertSheet(dateObjectTally.ballots === 2, "Date 讀回仍能計到票");
  const dateObjectBerry = dateObjectTally.results.find((row) => row.ingredientId === berry);
  const dateObjectPeptide = dateObjectTally.results.find((row) => row.ingredientId === peptide);
  assertSheet(dateObjectBerry && dateObjectBerry.approve === 1 && dateObjectBerry.oppose === 0, "Date 那一列的贊成要算進去");
  assertSheet(dateObjectPeptide && dateObjectPeptide.oppose === 1, "同一批讀回的文字日期也要計入");
  assertSheet(SheetTally.tallySheetRows(dateObjectRows, "2026-11-04").ballots === 0, "不應把台北午夜算成前一個 UTC 日");
  const marchValues = [
    ["receivedAt", "ballotId", "date", "ingredientId", "choice", "note"],
    ["2026-03-01T00:00:00.000Z", first, marchFirst, berry, "oppose", "跨月"]
  ];
  const marchRows = SheetTally.rowsFromSheetValues(marchValues).rows;
  assertSheet(marchRows[0].date === "2026-03-01", "月初的台北午夜不應被讀成前一個月");
  assertSheet(SheetTally.tallySheetRows(marchRows, "2026-03-01").ballots === 1, "跨月的 Date 讀回仍要計到票");
  const legacyDateObject = [
    ["receivedAt", "date", "ingredientId", "choice", "note"],
    [new Date("2026-11-05T00:30:00.000Z"), taipeiMidnight, berry, "approve", "舊日期物件"]
  ];
  const legacyDateRows = SheetTally.rowsFromSheetValues(SheetTally.migrateLegacyValues(legacyDateObject).values).rows;
  assertSheet(legacyDateRows[0].date === "2026-11-05", "舊版日期欄若被試算表存成 Date，遷移後仍應是 YYYY-MM-DD");
  assertSheet(SheetTally.tallySheetRows(legacyDateRows, "2026-11-05").ballots === 1, "舊版 Date 日期遷移後仍要計到票");
  const formatParts = (value, timeZone) => {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).formatToParts(value);
    const map = {};
    parts.forEach((part) => {
      if (part.type === "year" || part.type === "month" || part.type === "day") map[part.type] = part.value;
    });
    return map.year + "-" + map.month + "-" + map.day;
  };
  let seenZone = "";
  global.Utilities = {
    formatDate(value, timeZone, format) {
      seenZone = timeZone;
      if (format !== "yyyy-MM-dd") throw new Error("format");
      return formatParts(value, timeZone);
    }
  };
  try {
    let viaUtilities = SheetTally.rowsFromSheetValues(dateObjectValues).rows;
    assertSheet(seenZone === "Asia/Taipei" && viaUtilities[0].date === "2026-11-05", "沒有試算表時區時，用 Asia/Taipei 的 Utilities.formatDate");
    assertSheet(viaUtilities[0].receivedAt === "2026-11-05T01:23:45.000Z", "Utilities.formatDate 不應用在 receivedAt");
    assertSheet(SheetTally.tallySheetRows(viaUtilities, "2026-11-05").ballots === 2, "Utilities.formatDate 讀回仍能計到票");
    global.SpreadsheetApp = {
      getActiveSpreadsheet() {
        return { getSpreadsheetTimeZone: () => "Asia/Tokyo" };
      }
    };
    seenZone = "";
    viaUtilities = SheetTally.rowsFromSheetValues(dateObjectValues).rows;
    assertSheet(seenZone === "Asia/Tokyo" && viaUtilities[0].date === "2026-11-05", "有試算表時區時，formatDate 應使用該時區");
    assertSheet(SheetTally.tallySheetRows(viaUtilities, "2026-11-05").ballots === 2, "試算表時區讀回的 Date 仍要計到票");
  } finally {
    delete global.Utilities;
    delete global.SpreadsheetApp;
  }
  assertSheet(SheetTally.headerMigration(["receivedAt", "ballotId", "date", "ingredientId", "choice", "note", ""]).action === "ready", "結尾空白欄不應被當成未知表頭");
  assertSheet(SheetTally.headerMigration(["receivedAt", "email"]).action === "unknown", "不認得的表頭不應覆寫");
  assertSheet(sheetError(() => SheetTally.parseBallotPost(SheetTally.buildCloudBallot("2026-11-05", first, [
    { ingredientId: berry, choice: "approve", note: "" },
    { ingredientId: berry, choice: "oppose", note: "" }
  ]))) === "ingredient", "同一份選票不應對同一原料投兩次");
  const round = SheetTally.sheetValuesFromRows(SheetTally.rowsFromSheetValues(values).rows);
  assertSheet(JSON.stringify(round) === JSON.stringify(values), "寫回試算表再讀出應得到同一批列");
  const echo = "https://script.googleusercontent.com/macros/echo?user_content_key=abc";
  const redirect = SheetTally.gasRedirectAction(302, echo);
  assertSheet(redirect.action === "get-echo" && redirect.url === echo, "302 應改以 GET 讀 echo 網址");
  assertSheet(SheetTally.gasRedirectAction(200, echo).action === "read", "200 應直接讀本文");
  assertSheet(SheetTally.gasRedirectAction(302, "").action === "read", "沒有 Location 時不應另發請求");
  assertSheet(SheetTally.gasRedirectAction(0, echo).action === "read", "不透明轉址沒有可讀的 Location");
  const appSource = fs.readFileSync(path.join(root, "docs", "app.js"), "utf8");
  const libSource = fs.readFileSync(path.join(root, "scripts", "lib", "sheet-tally.js"), "utf8");
  assertSheet(appSource.includes('action: "get-echo"') && libSource.includes('action: "get-echo"'), "投票頁要實作 echo GET");
  assertSheet(appSource.includes('redirect: "follow"'), "投票頁的 Apps Script 請求要跟隨 302");
  assertSheet(functionBody(appSource, "gasRedirectAction") === functionBody(libSource, "gasRedirectAction"), "投票頁與測試用的轉址判斷必須相同");
}

function functionBody(source, name) {
  const token = "function " + name;
  const start = source.indexOf(token);
  if (start < 0) return "";
  const open = source.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    else if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1).replace(/\r\n/g, "\n").trim();
    }
  }
  return "";
}

const raw = loadRaw(root);
const ingredientsById = new Map();
for (const entry of raw.ingredients) {
  checkIngredient(entry);
  if (entry.data?.id) {
    if (ingredientsById.has(entry.data.id)) fail("原料 id 重複：" + entry.data.id);
    ingredientsById.set(entry.data.id, entry.data);
  }
}
if (raw.ingredients.length < 1) fail("至少要有一筆原料");
for (const entry of raw.days) checkDay(entry, ingredientsById);
checkDocs();
checkVoteModel();
checkSheetTally();
checkCatalog();

if (errors.length) {
  for (const error of errors) console.error("ERROR " + error);
  console.error(errors.length + " 項檢查沒過");
  process.exit(1);
}
console.log(
  "ok",
  raw.ingredients.length,
  "ingredients,",
  raw.days.length,
  "days, vote model"
);

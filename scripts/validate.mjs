import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { buildCatalog, loadRaw, readJson, serializeCatalog } from "./lib/catalog.mjs";

const require = createRequire(import.meta.url);
const VoteModel = require("../docs/vote-model.js");
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
    fail(where + " 標成代理或經銷時，要填台灣窗口名稱");
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

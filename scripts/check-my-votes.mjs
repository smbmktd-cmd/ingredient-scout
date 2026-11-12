// 本機靜態頁的「我的投票紀錄」檢查。需要已安裝的 playwright，不進 CI。
// 會攔截 Formspree 與 Apps Script，不會送出真票。
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const catalog = JSON.parse(readFileSync(path.join(root, "docs", "catalog.json"), "utf8"));
const dayA = catalog.days[0];
const dayB = catalog.days[1];
const ingA = dayA.picks[0];
const ingB = dayB.picks.find((item) => item.id !== ingA.id) || dayB.picks[0];
const port = 41731;
const origin = "http://127.0.0.1:" + port;

function fail(message) {
  throw new Error(message);
}

function remote(url) {
  return /formspree\.io|script\.google\.com|googleusercontent\.com/.test(url);
}

async function listen(portToUse) {
  const server = spawn("python3", ["-m", "http.server", String(portToUse), "--bind", "127.0.0.1"], {
    cwd: path.join(root, "docs"),
    stdio: "ignore"
  });
  const started = Date.now();
  while (Date.now() - started < 8000) {
    try {
      const response = await fetch(origin + "/index.html");
      if (response.ok) return server;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  server.kill();
  fail("靜態伺服器沒有起來");
}

async function mockRemotes(page, hits) {
  await page.route("**/*", async (route) => {
    const request = route.request();
    const url = request.url();
    if (!remote(url)) {
      await route.continue();
      return;
    }
    hits.push({ url, method: request.method(), body: request.postData() || "" });
    if (request.method() === "OPTIONS") {
      await route.fulfill({
        status: 204,
        headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-methods": "GET,POST,OPTIONS",
          "access-control-allow-headers": "*"
        }
      });
      return;
    }
    const date = new URL(url).searchParams.get("date") || dayA.date;
    const body = request.method() === "GET"
      ? JSON.stringify({ ok: true, date, ballots: 0, results: [] })
      : JSON.stringify({ ok: true });
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "access-control-allow-origin": "*" },
      body
    });
  });
}

async function openPage(browser, viewport, seed) {
  const page = await browser.newPage({ viewport });
  const hits = [];
  await mockRemotes(page, hits);
  if (seed) {
    await page.addInitScript((payload) => {
      localStorage.setItem("ingredient-scout.votes.v1", payload);
    }, seed);
  }
  page.on("pageerror", (error) => {
    console.error("PAGE " + error.message);
  });
  page.on("dialog", async (dialog) => {
    if (dialog.message().includes("清除")) await dialog.accept();
    else await dialog.dismiss();
  });
  await page.goto(origin + "/?date=" + encodeURIComponent(dayA.date), { waitUntil: "domcontentloaded" });
  await page.locator("#ingredient-" + ingA.id).waitFor();
  return { page, hits };
}

async function counts(page) {
  return {
    approve: await page.locator("#mine-approve-count").innerText(),
    oppose: await page.locator("#mine-oppose-count").innerText()
  };
}

async function openMine(page, choice) {
  const button = page.locator(choice === "approve" ? "#mine-approve" : "#mine-oppose");
  const pressed = await button.getAttribute("aria-pressed");
  if (pressed !== "true") await button.click();
  await page.locator("#mine-panel").waitFor({ state: "visible" });
  if (await button.getAttribute("aria-pressed") !== "true") fail(choice + " 按鈕沒有維持展開");
}

async function expectItem(page, ingredient, date, note) {
  const item = page.locator('.mine-item[data-date="' + date + '"][data-id="' + ingredient.id + '"]');
  await item.waitFor();
  const text = await item.innerText();
  if (!text.includes(ingredient.names.commonZh)) fail("清單缺少中文名 " + ingredient.names.commonZh + "：" + text);
  if (!text.includes(ingredient.names.trade)) fail("清單缺少商品名：" + text);
  if (!text.includes(date)) fail("清單缺少日報日期：" + text);
  if (note && !text.includes(note)) fail("清單缺少備註：" + text);
  return item;
}

async function clickIntoView(locator) {
  await locator.evaluate((node) => node.scrollIntoView({ block: "center", inline: "nearest" }));
  await locator.click();
}

async function vote(page, ingredient, choice, note) {
  const card = page.locator("#ingredient-" + ingredient.id);
  await card.locator("textarea").fill(note);
  await clickIntoView(card.locator('button[data-choice="' + choice + '"]'));
}

function shot(page, file) {
  return page.screenshot({ path: file });
}

async function legacyRoundTrip(browser) {
  const seed = JSON.stringify({
    [dayA.date]: [
      {
        ingredientId: ingA.id,
        choice: "approve",
        note: "舊格式贊成",
        updatedAt: dayA.date + "T00:00:00.000Z"
      }
    ],
    [dayB.date]: {
      [ingB.id]: {
        choice: "oppose",
        note: "舊格式反對",
        updatedAt: dayB.date + "T01:00:00.000Z"
      }
    }
  });
  const { page } = await openPage(browser, { width: 1280, height: 900 }, seed);
  const before = await counts(page);
  if (before.approve !== "1" || before.oppose !== "1") fail("舊紀錄載入後筆數不對：" + JSON.stringify(before));
  await openMine(page, "approve");
  await expectItem(page, ingA, dayA.date, "舊格式贊成");
  await openMine(page, "oppose");
  await expectItem(page, ingB, dayB.date, "舊格式反對");
  if (await page.locator('.mine-item[data-id="' + ingA.id + '"]').count()) fail("反對清單不該出現贊成的原料");
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator("#ingredient-" + ingA.id).waitFor();
  const afterReload = await counts(page);
  if (afterReload.approve !== "1" || afterReload.oppose !== "1") fail("重新整理後舊紀錄消失：" + JSON.stringify(afterReload));
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("ingredient-scout.votes.v1")));
  if (Array.isArray(stored[dayA.date])) fail("舊的陣列紀錄沒有折回日期物件");
  if (stored[dayA.date][ingA.id].choice !== "approve" || stored[dayA.date][ingA.id].note !== "舊格式贊成") {
    fail("遷移後贊成票不見");
  }
  if (stored[dayB.date][ingB.id].choice !== "oppose" || stored[dayB.date][ingB.id].note !== "舊格式反對") {
    fail("遷移時把另一天的反對票弄丟了");
  }
  await page.close();
}

async function uiRoundTrip(browser) {
  const desktop = "/tmp/mine-desktop.png";
  const mobile = "/tmp/mine-mobile.png";
  const { page, hits } = await openPage(browser, { width: 1280, height: 900 }, null);
  const html = await page.content();
  if (html.includes("知道連結就能表態") || html.includes("不索取姓名") || html.includes("工作人員：合併多人投票") || html.includes('id="staff"')) {
    fail("已移除的說明或合併區段又出現了");
  }
  const mineBox = await page.locator("#mine-approve").boundingBox();
  const searchBox = await page.locator("#ingredient-search").boundingBox();
  if (!mineBox || !searchBox || mineBox.y >= searchBox.y) fail("我的投票按鈕不在搜尋列上方");

  await page.locator("#mine-approve").click();
  await page.locator("#mine-empty").waitFor({ state: "visible" });
  const emptyApprove = await page.locator("#mine-empty").innerText();
  if (!emptyApprove.includes("還沒有贊成")) fail("贊成空狀態不夠清楚：" + emptyApprove);
  await page.locator("#mine-approve").click();
  await page.locator("#mine-panel").waitFor({ state: "hidden" });
  await page.locator("#mine-oppose").click();
  const emptyOppose = await page.locator("#mine-empty").innerText();
  if (!emptyOppose.includes("還沒有反對")) fail("反對空狀態不夠清楚：" + emptyOppose);
  await page.locator("#mine-approve").click();
  if (await page.locator("#mine-approve").getAttribute("aria-pressed") !== "true") fail("點另一顆時沒有切換到贊成");
  if (await page.locator("#mine-oppose").getAttribute("aria-pressed") !== "false") fail("切換後反對按鈕仍是展開");
  await page.locator("#mine-approve").click();

  const noteA = "這天先贊成";
  const noteB = "這天先反對";
  await vote(page, ingA, "approve", noteA);
  let now = await counts(page);
  if (now.approve !== "1" || now.oppose !== "0") fail("投下贊成後筆數不對：" + JSON.stringify(now));
  await page.locator("#live").getByText("已同步到試算表").waitFor({ timeout: 8000 });
  const sheet = hits.find((hit) => hit.method === "POST" && hit.url.includes("script.google.com"));
  const form = hits.find((hit) => hit.method === "POST" && hit.url.includes("formspree.io"));
  if (!sheet || !form) fail("表態沒有送到試算表與 Formspree 的攔截點：" + JSON.stringify(hits.map((hit) => hit.method + " " + hit.url)));
  const sheetBody = JSON.parse(sheet.body);
  if (sheetBody.kind !== "ingredient-scout-votes" || !sheetBody.votes.some((row) => row.ingredientId === ingA.id && row.choice === "approve" && row.note === noteA)) {
    fail("試算表攔截到的內容不是這張贊成票");
  }
  if (!form.body.includes(noteA)) fail("Formspree 攔截到的內容沒有備註");

  await openMine(page, "approve");
  await expectItem(page, ingA, dayA.date, noteA);
  const edited = "這天先贊成，補一句";
  await page.locator("#ingredient-" + ingA.id + " textarea").fill(edited);
  await expectItem(page, ingA, dayA.date, edited);

  await page.locator("#date").selectOption(dayB.date);
  await page.locator("#ingredient-" + ingB.id).waitFor();
  await vote(page, ingB, "oppose", noteB);
  now = await counts(page);
  if (now.approve !== "1" || now.oppose !== "1") fail("跨日投票後筆數不對：" + JSON.stringify(now));
  await openMine(page, "oppose");
  await expectItem(page, ingB, dayB.date, noteB);
  if (await page.locator('#mine-list .mine-item[data-date="' + dayA.date + '"]').count()) fail("反對清單混進了另一天的贊成");
  await openMine(page, "approve");
  await expectItem(page, ingA, dayA.date, edited);
  if (await page.locator('#mine-list .mine-item[data-id="' + ingB.id + '"]').count()) fail("贊成清單混進了反對票");

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator("article.card").first().waitFor();
  now = await counts(page);
  if (now.approve !== "1" || now.oppose !== "1") fail("重新整理後筆數不對：" + JSON.stringify(now));
  await openMine(page, "approve");
  await expectItem(page, ingA, dayA.date, edited);
  await openMine(page, "oppose");
  await expectItem(page, ingB, dayB.date, noteB);
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("ingredient-scout.votes.v1")));
  if (stored[dayA.date][ingA.id].choice !== "approve" || stored[dayB.date][ingB.id].choice !== "oppose") {
    fail("重新整理後 localStorage 沒有同時留下兩天");
  }

  await openMine(page, "approve");
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot(page, desktop);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator("article.card").first().waitFor();
  await openMine(page, "approve");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  if (overflow > 1) fail("390px 出現橫向溢出：" + overflow);
  for (const selector of ["#mine-approve", "#mine-oppose", "#ingredient-search", "#mine-panel"]) {
    const box = await page.locator(selector).boundingBox();
    if (!box || box.x < -1 || box.x + box.width > 391) fail(selector + " 在 390px 超出畫面：" + JSON.stringify(box));
  }
  const mobileMine = await page.locator("#mine-approve").boundingBox();
  const mobileSearch = await page.locator("#ingredient-search").boundingBox();
  if (mobileMine.y >= mobileSearch.y) fail("手機上按鈕沒有在搜尋列上方");
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot(page, mobile);

  await page.locator("#date").selectOption(dayA.date);
  await page.locator("#ingredient-" + ingA.id).waitFor();
  await openMine(page, "approve");
  await clickIntoView(page.locator('#ingredient-' + ingA.id + ' button[data-choice="oppose"]'));
  now = await counts(page);
  if (now.approve !== "0") fail("改投後贊成筆數沒有立刻歸零：" + JSON.stringify(now));
  if (await page.locator("#mine-empty").isHidden()) fail("改投後贊成清單沒有立刻變成空狀態");
  await openMine(page, "oppose");
  await expectItem(page, ingA, dayA.date, edited);
  await expectItem(page, ingB, dayB.date, noteB);
  if ((await counts(page)).oppose !== "2") fail("改投後反對應有兩筆");

  await page.locator("#date").selectOption(dayB.date);
  await page.locator("#ingredient-" + ingB.id).waitFor();
  await clickIntoView(page.locator("#clear"));
  await page.locator("#ingredient-" + ingB.id + ' button[data-choice="oppose"][aria-pressed="false"]').waitFor();
  now = await counts(page);
  if (now.oppose !== "1" || now.approve !== "0") fail("取消一天後筆數不對：" + JSON.stringify(now));
  if (await page.locator('#mine-list .mine-item[data-date="' + dayB.date + '"]').count()) fail("取消後那天的票還留在清單");
  await expectItem(page, ingA, dayA.date, edited);

  await page.locator('.mine-item[data-date="' + dayA.date + '"][data-id="' + ingA.id + '"]').click();
  await page.waitForFunction((expected) => {
    const url = new URL(window.location.href);
    return url.searchParams.get("date") === expected.date && url.hash === "#ingredient-" + expected.id;
  }, { date: dayA.date, id: ingA.id });
  if (await page.locator("#date").inputValue() !== dayA.date) fail("跳轉後日期選單沒有切過去");
  const card = page.locator("#ingredient-" + ingA.id);
  await card.waitFor();
  await page.waitForFunction((id) => {
    const node = document.getElementById("ingredient-" + id);
    if (!node) return false;
    const box = node.getBoundingClientRect();
    return box.top < window.innerHeight * 0.45 && box.bottom > 0;
  }, ingA.id, { timeout: 4000 });
  const cardBox = await card.boundingBox();
  if (!cardBox || cardBox.y > 844 || cardBox.y + 20 < 0) fail("跳轉後原料卡片不在畫面裡：" + JSON.stringify(cardBox));
  if (!(await card.getAttribute("class")).includes("is-located")) fail("跳轉後沒有標出該原料卡片");

  await page.locator("#ingredient-search").fill(ingB.names.commonZh);
  const option = page.locator("#search-list [role='option']").filter({ hasText: ingB.names.commonZh }).first();
  await option.waitFor();
  const inputBox = await page.locator("#ingredient-search").boundingBox();
  const panelBox = await page.locator("#search-panel").boundingBox();
  if (!panelBox || panelBox.y < inputBox.y) fail("搜尋建議沒有出現在輸入框下方");
  await option.click();
  await page.waitForFunction((expected) => {
    const url = new URL(window.location.href);
    return url.searchParams.get("date") === expected.date && url.hash === "#ingredient-" + expected.id;
  }, { date: dayB.date, id: ingB.id });
  await page.locator("#ingredient-" + ingB.id).waitFor();
  await page.close();
  return { desktop, mobile };
}

const server = await listen(port);
const browser = await chromium.launch({ headless: true });
try {
  await legacyRoundTrip(browser);
  const shots = await uiRoundTrip(browser);
  console.log("ok", shots.desktop, shots.mobile);
} finally {
  await browser.close();
  server.kill();
}

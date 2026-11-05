/**
 * 可選的匿名收集端：把投票 JSON 追加到這份試算表。
 *
 * 部署
 * 1. 建立空白 Google 試算表，擴充功能 → Apps Script，貼上這個檔案。
 * 2. 部署 → 新增部署 → 類型選「網頁應用程式」。
 * 3. 執行身分選「我」，存取權選「任何人」。
 * 4. 把網頁應用程式網址貼到 docs/config.js 的 submitEndpoint，submitMode 填 "webhook"。
 *
 * 試算表請自行在第一列寫上：receivedAt、date、ingredientId、choice、note。
 * 這個腳本不讀取帳號、信箱或 IP。同一人改票後再送一次會多一列，
 * 正式計票仍以每人下載的 JSON、由工作人員彙總的結果為準。
 */
function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);
    if (data.kind !== "ingredient-scout-votes" || !Array.isArray(data.votes)) {
      return json_({ ok: false });
    }
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
    var now = new Date().toISOString();
    data.votes.forEach(function (vote) {
      sheet.appendRow([
        now,
        String(data.date || ""),
        String(vote.ingredientId || ""),
        String(vote.choice || ""),
        String(vote.note || "")
      ]);
    });
    return json_({ ok: true });
  } catch (err) {
    return json_({ ok: false });
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

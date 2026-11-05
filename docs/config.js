// 投票頁設定。兩個網址都留空時，只在這台裝置記錄並下載 JSON。
// 網址會出現在公開的 GitHub Pages 原始碼裡，知道網址的人都能送資料，不要當成門禁。
// 這個專案已接上企劃課的票箱與計票端點。用範本開新專案時，請改 teamLabel、repoUrl 與下面兩個網址。
window.VOTE_CONFIG = {
  teamLabel: "膳食補充品原料日選",
  repoUrl: "https://github.com/smbmktd-cmd/ingredient-scout",

  // Formspree：收件匣／備份。每送出一張匿名票，信箱或 Formspree 後台會留一份。
  // 到 formspree.io 建表單，確認它不要求填信箱。把端點貼到下面。
  // 例：https://formspree.io/f/xxxxxxxx
  // 留空表示不送 Formspree。
  formspreeEndpoint: "https://formspree.io/f/xyeeobra",

  // 相容舊設定。formspreeEndpoint 為空、且 submitMode 為 "formspree" 時，改用 submitEndpoint。
  // submitMode 為 "webhook" 且 tallyEndpoint、sheetEndpoint 都空時，submitEndpoint 當作試算表網址。
  // 新設定請把網址填進上面的 formspreeEndpoint 與下面的 tallyEndpoint，這兩欄可留空。
  submitEndpoint: "",
  submitMode: "",

  // Google Apps Script 網頁應用程式（網址以 /exec 結尾）。
  // 頁面用它 POST 選票、GET 團隊累計。部署步驟見 optional/google-apps-script/Code.gs。
  // 例：https://script.google.com/macros/s/xxxxxxxx/exec
  // 留空則不顯示團隊累計，行為與只記在這台裝置時相同。
  tallyEndpoint: "https://script.google.com/macros/s/AKfycbxKpeI7oCFjAbrotdptgLOGpaEhrZW9wRSRkqJjNl4CzwzVWtM7yDWoUhQw0N9xBz3fmA/exec",

  // 與 tallyEndpoint 相同。只填其中一個即可；兩個都填時以 tallyEndpoint 為準。
  sheetEndpoint: ""
};

// 投票頁設定。預設不把任何內容送到別的伺服器。
// 用這個範本開新專案時，請改 teamLabel 與 repoUrl。
window.VOTE_CONFIG = {
  teamLabel: "膳食補充品原料日選",
  repoUrl: "https://github.com/smbmktd-cmd/ingredient-scout",
  // 留空：只在這台裝置記錄，並下載 JSON。
  // Formspree 範例：https://formspree.io/f/xxxxxxxx ，submitMode 填 "formspree"
  // 自建網址（含本儲存庫 optional/google-apps-script）填 "webhook"
  submitEndpoint: "",
  submitMode: ""
};

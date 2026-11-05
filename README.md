# 原料偵察與匿名投票

業務同事每天從公開資訊裡挑大約 5 個膳食補充品原料，做成可投票的卡片，決定哪些值得再深掘。這個儲存庫是該流程的範本：原料資料、深掘卷宗、以及一份不用登入的投票頁。

練習用的兩筆原料（極光莓萃取、露明肽）與 2026-11-05 日報都是虛構的。它們用來示範欄位，不能引用成功效、劑量或 TFDA 核准。

## 每天產出什麼

每位偵察的人交一份當日名單，約 5 張卡片。五張要混著三個管道，不要五張都來自同一則新聞：

1. **新聞** `news`：最新的原料或產品消息。
2. **展覽名錄** `exhibition`：大型原料展公開的供應商名單。
3. **產業報導** `industry_report`：生技或原料產業的新聞、簡報、觀察報告。

每一張卡片本身也要有多個來源。主管道只標一個，其餘來源可以是供應商官網、論文或專利頁。

投票頁讓知道連結的同事對每一張卡片按 **贊成** 或 **反對**，也可以留一句備註。沒有密碼。頁面不詢問姓名。

## 目錄

| 路徑 | 用途 |
| --- | --- |
| `data/ingredients/*.json` | 一原料一檔 |
| `data/days/YYYY-MM-DD.json` | 當天要投的 id 清單 |
| `data/votes/` | 給工作人員留彙總 JSON，目前只有佔位 |
| `data/SCHEMA.md` | 欄位定義 |
| `templates/ingredient-dossier.md` | 單筆深掘卷宗，含查核清單 |
| `templates/ingredient.blank.json` | 原料空白檔 |
| `templates/day.blank.json` | 日報空白檔 |
| `docs/` | 投票頁。GitHub Pages 請發佈這個資料夾 |
| `docs/config.js` | 團隊名稱、儲存庫網址、可選的收集端 |
| `optional/google-apps-script/Code.gs` | 可選的試算表收集端 |
| `scripts/build-catalog.mjs` | 把 `data/` 編成投票頁讀的目錄 |
| `scripts/validate.mjs` | 檢查欄位、範例標記與投票邏輯 |

## 欄位一覽

完整說明在 [`data/SCHEMA.md`](data/SCHEMA.md)。每筆原料至少要有：

| 同事看到的內容 | JSON |
| --- | --- |
| 台灣能不能當食品原料／添加物、證據註記、查詢日 | `tfda.usable`、`tfda.evidenceNotes`、`tfda.lookupDate` |
| 供應商、國家 | `supply.supplierName`、`supply.supplierCountry` |
| 供應商與台灣代理／經銷的關係 | `supply.relationship`、`supply.taiwanPartyName`、`supply.relationshipNote` |
| 學名、俗名、商品名 | `names.scientific`、`names.commonZh`、`names.commonEn`、`names.trade` |
| 宣稱效益、建議劑量 | `efficacy.claimedBenefits`、`efficacy.suggestedDosage` |
| 專利、文獻 | `patent.status`、`literature.status`（`yes`／`no`／`unknown`） |
| 證據等級 | `evidenceLevels`：`in_vitro`、`cell`、`animal`、`clinical`，可多選，沒有就空陣列 |
| 官網圖片網址、可選的本地圖 | `images[].url`、`images[].localPath` |
| 多個來源連結 | `sources`（至少兩筆） |
| 主管道 | `discovery.channel`：`news`、`exhibition`、`industry_report` |
| 偵察日、偵察註記 | `discovery.scoutDate`、`discovery.notes` |

## TFDA 怎麼查

食品原料與添加物先用查詢助手：

<https://yoyosu890524-byte.github.io/tfda-lookup/>

助手是靜態網頁。第一次開啟時要有網路，它才下載得到資料檔。載入後頁首有三個分頁：

1. **食品原料**：可用大分類、次分類縮小範圍。關鍵字可打中文名、外文名或學名，再按「搜尋」。點卡片看完整欄位，常見內容有大分類、次分類、中文名稱、外文名稱、學名、部位、備註。
2. **食品添加物**：換到這個分頁，用同一組名稱再查一次。看類別、中文品名、英文品名，以及使用食品範圍及限量、使用限制、規格。
3. **更新歷程**：用來知道資料最近有沒有改版，不是准駁依據。

若卡片出現「未確認安全性，尚不得使用」，狀態填 `unconfirmed_not_for_food_use`，並把該句抄進證據註記。

頁面若只剩「離線資料尚未下載，請連上網路開啟一次。」，表示資料檔沒載入。換網路或稍後再試。仍然打不開就改查官方頁，狀態先填 `lookup_blocked`，把畫面上的句子寫進證據註記。不要為了補資料去爬這個助手或食藥署網站。

官方頁：

- 食品原料整合查詢平臺：<https://consumer.fda.gov.tw/Food/Material.aspx?nodeID=160>
- 食品添加物使用範圍及限量暨規格標準：<https://consumer.fda.gov.tw/Law/FoodAdditivesList.aspx?nodeID=521>

助手頁首寫的資料來源是 TFDA 消費者專區詳細頁與開放資料（原料 InfoId 4、添加物使用範圍 InfoId 61）。有命中時，仍請到官方頁點進該筆，核對限制。原料平臺收錄的是已評估項目，傳統食品不會全部列在上面。查無資料時填 `not_found`，寫明查過的詞、分頁與筆數。這個狀態表示「這次沒查到」，接下來要不要送審、能不能用，另依適用規定判斷，不要在卡片上寫成已核准。

列名也不等於供應商建議的劑量可以使用。備註、限量、部位、警語要一併抄進 `tfda.queries`。

這個流程不查健康食品許可證。許可證號不要填進 `tfda.usable`。

狀態對照、打不開時要留的欄位、以及逐詞查詢表，寫在 [`templates/ingredient-dossier.md`](templates/ingredient-dossier.md)。

## 每日要填的內容

1. 複製 `templates/ingredient.blank.json` 為 `data/ingredients/<id>.json`。`id` 用小寫英文與連字號，例如 `citrus-peel-extract`。
2. 依卷宗查完再填。每筆至少兩個來源。五筆的主管道要涵蓋新聞、展覽名錄、產業報導中的組合，不要同一天只有一種。
3. TFDA：原料分頁與添加物分頁都留下關鍵字和筆數，填查詢日與證據註記。
4. 複製 `templates/day.blank.json` 為 `data/days/YYYY-MM-DD.json`，`picks` 放那 5 個 id，`example` 設為 `false`。
5. 產生投票目錄並檢查：

   ```bash
   node scripts/build-catalog.mjs
   node scripts/validate.mjs
   ```

6. 提交後，把當日連結傳給要表態的同事。連結形式見下方。

正式日報若不是剛好 5 筆，檢查會失敗。練習日報 `example: true` 可以少於 5 筆，而且只能引用同樣標成練習的原料。本儲存庫附兩份練習日報：`2026-11-05` 有 2 筆，`2026-11-04` 只有 1 筆，用來試日期選單。都不是正式作業的五筆。

## 在自己的電腦看投票頁

投票頁是靜態檔，放在 `docs/`，不需要建置步驟。目錄檔 `docs/catalog.js` 要先產生（上面的指令）。再用一個本機網頁伺服器開啟，避免瀏覽器擋住檔案讀取：

```bash
python3 -m http.server 8765
```

瀏覽器開 <http://127.0.0.1:8765/docs/?date=2026-11-05>。

直接雙擊 `docs/index.html` 通常也可以，因為目錄是用 `<script>` 載入的。若畫面寫讀不到目錄，改用上面的指令。

## 啟用 GitHub Pages

1. 打開儲存庫的 **Settings → Pages**。
2. **Build and deployment** 的 Source 選 **Deploy from a branch**。
3. Branch 選 `main`，資料夾選 **`/docs`**，儲存。
4. 等狀態變成已發佈。專案網站的位址是：

   <https://smbmktd-cmd.github.io/ingredient-scout/>

5. 若 Pages 的資料夾誤設成根目錄，根目錄的 `index.html` 會轉到 `docs/index.html`。正式設定仍請用 `/docs`。

頁面是公開的。知道網址的人都能投票。連結請只傳給要表態的同事，並接受匿名頁面無法從技術上阻止有人重投。計票方式見下一節。

把這個專案 **Use this template** 之後，網址裡的帳號與儲存庫名稱會改變，請一併改 `docs/config.js` 的 `repoUrl`，以及 `.github/ISSUE_TEMPLATE/config.yml` 裡的投票頁網址。

## 同事怎麼開連結

傳這一種網址即可，不需要 GitHub 帳號，也不要設密碼：

```text
https://smbmktd-cmd.github.io/ingredient-scout/?date=2026-11-05
```

把日期換成當天的 `data/days/` 檔名。手機與電腦都用同一個連結。頁面是直式卡片：供應商、TFDA 狀態、效益、劑量、來源都在卡片上，底部可下載自己的投票。

表態方式：

- 每筆原料按 **贊成** 或 **反對**。
- 備註可以不寫。寫了會進入下載檔，所以不要留姓名、綽號、部門或信箱。
- 同一台瀏覽器對同一筆再按一次，只會改成新的選擇，不會變成兩票。這份記憶放在這台瀏覽器的 localStorage，沒有帳號。
- 清除網站資料、或換一台裝置，之前沒下載的選擇會消失。離開前按 **下載投票 JSON**。

## 票存在哪裡

預設不把內容送到任何伺服器。投票頁一定做得到這三件事：

1. **畫面上的本機計數**：只統計這台瀏覽器，標題寫明還不是團隊總數。
2. **下載投票 JSON**：檔名像 `votes-2026-11-05.json`。一份檔案是一張匿名票，同一原料只有一列。
3. **複製分享連結**：連結的 `#ballot=` 後面是同一份投票。同事把連結或 JSON 交給負責彙總的人。

負責彙總的人打開投票頁下方「工作人員：合併多人投票」，匯入每個人的 JSON 或貼上分享連結。完全相同的檔案只算一次。其他日期的檔案不會算進目前選的那一天。確認張數後下載 `vote-summary-YYYY-MM-DD.json`，需要留底再放到 `data/votes/`。

請每人交最新的一份。同一人先後交了兩版不同內容時，畫面上會看成兩張票；彙總的人可按「移除」去掉舊的那份。

### 可選的共享收集端

`docs/config.js` 的 `submitEndpoint` 保持空白時，頁面上不會出現外送按鈕。要改成多人寫進同一個表單時，二選一：

**Formspree**

1. 在 Formspree 建一張表單，確認它不要求填信箱。
2. `submitEndpoint` 填 `https://formspree.io/f/xxxxxxxx`。
3. `submitMode` 填 `formspree`。

**Google 試算表**

`optional/google-apps-script/Code.gs` 裡有部署步驟。部署成「任何人」可開啟的網頁應用程式後，把網址填進 `submitEndpoint`，`submitMode` 填 `webhook`。

送出的是整份當日投票，不含姓名。同一份內容連按兩次不會重送；改了選擇或備註可以再送。瀏覽器若擋下跨站請求，頁面會保留本機記錄並請同事改下載。試算表可能在同一人改票後多出一列，所以正式張數仍以彙總 JSON 為準。

收集端網址會寫在公開的 JavaScript 裡，知道網址的人都能送資料。它是方便用的副本，不是門禁。

不要改用 GitHub Issue 收集投票。Issue 會帶出送出者的 GitHub 帳號，就不是匿名表態。

## 當成 GitHub 範本

1. 儲存庫 **Settings → General**，勾選 **Template repository**。
2. 之後用 **Use this template** 開新專案，不要直接在這個範本上累積真實原料。
3. 新專案請改 `docs/config.js` 的 `teamLabel` 與 `repoUrl`，啟用 Pages 的 `/docs`，並把練習日報留著當欄位範例，或在正式日報裡不要引用它們。
4. 授權是 MIT，見 `LICENSE`。改資料的方式見 `CONTRIBUTING.md`。

## 檢查

```bash
node scripts/validate.mjs
```

`package.json` 裡的 `npm test` 也是這道指令。沒有需要安裝的套件。拉取請求會跑 `.github/workflows/validate.yml`。

檢查包含：必填欄位、TFDA 狀態、練習檔是否仍標成虛構、正式日報是否為 5 筆、`docs/catalog.js` 是否與 `data/` 一致，以及投票的改票、分享碼與彙總是否會把同一份檔案算成兩票。

# 原料偵察與匿名投票

業務同事每天從公開資訊裡挑大約 5 個膳食補充品原料，做成可投票的卡片，決定哪些值得再深掘。這個儲存庫是該流程的範本：原料資料、深掘卷宗、以及一份不用登入的投票頁。

練習用的兩筆原料（極光莓萃取、露明肽）是虛構的，只留在 `data/ingredients` 當欄位示範，不能引用成功效、劑量或 TFDA 核准。`2026-11-04` 仍是練習日報。`2026-11-05` 是正式五筆，不要再把那兩筆虛構原料放進當天名單。

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
| `docs/config.js` | 團隊名稱、儲存庫網址、Formspree 與試算表網址 |
| `optional/google-apps-script/Code.gs` | 試算表收集與頁面上的團隊累計 |
| `scripts/lib/sheet-tally.js` | 試算表改票與計票的純函式，供檢查腳本與 Code.gs 共用 |
| `scripts/build-catalog.mjs` | 把 `data/` 編成投票頁讀的目錄 |
| `scripts/validate.mjs` | 檢查欄位、範例標記與投票邏輯 |

## 欄位一覽

完整說明在 [`data/SCHEMA.md`](data/SCHEMA.md)。每筆原料至少要有：

| 同事看到的內容 | JSON |
| --- | --- |
| 台灣能不能當食品原料／添加物、證據註記、查詢日 | `tfda.usable`、`tfda.evidenceNotes`、`tfda.lookupDate` |
| 供應商、國家 | `supply.supplierName`、`supply.supplierCountry` |
| 供應商與台灣關聯廠商 | `supply.relationship`、`supply.taiwanPartyName`、`supply.relationshipNote` |
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

正式日報若不是剛好 5 筆，檢查會失敗。練習日報 `example: true` 可以少於 5 筆，而且只能引用同樣標成練習的原料。`2026-11-04` 是練習日報，只有 1 筆虛構原料，用來試日期選單。`2026-11-05` 是正式日報，剛好 5 筆，不引用虛構原料。

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

頁面是公開的。知道網址的人都能投票，沒有登入。連結請只傳給要表態的同事，並接受匿名頁面無法從技術上阻止有人重投。若設定了試算表，打開連結就會看到當時的團隊累計。計票方式見下一節。

把這個專案 **Use this template** 之後，網址裡的帳號與儲存庫名稱會改變，請一併改 `docs/config.js` 的 `repoUrl`，以及 `.github/ISSUE_TEMPLATE/config.yml` 裡的投票頁網址。

## 同事怎麼開連結

傳這一種網址即可，不需要 GitHub 帳號，也不要設密碼：

```text
https://smbmktd-cmd.github.io/ingredient-scout/?date=2026-11-05
```

把日期換成當天的 `data/days/` 檔名。手機與電腦都用同一個連結。頁面是直式卡片：供應商、TFDA 狀態、效益、劑量、來源都在卡片上，底部可下載自己的投票。

表態方式：

- 每筆原料按 **贊成** 或 **反對**。
- 備註可以不寫。寫了會出現在下載檔，也會出現在團隊累計的備註欄，所以不要留姓名、綽號、部門或信箱。
- 同一台瀏覽器對同一筆再按一次，只會改成新的選擇，不會變成兩票。這份記憶放在這台瀏覽器的 localStorage，並附一組隨機票號，沒有帳號。
- 清除網站資料、或換一台裝置，會變成另一張票。離開前按 **下載投票 JSON**。已同步進試算表的那一票仍留在表上，直到同一台瀏覽器再送出清除。

## 票存在哪裡

兩個網址都留空時，內容不會送到別的伺服器。投票頁一定做得到這三件事：

1. **本機計數**：只統計這台瀏覽器。沒接試算表時，標題會寫明還不是團隊總數。
2. **下載投票 JSON**：檔名像 `votes-2026-11-05.json`。一份檔案是一張匿名票，同一原料只有一列。下載檔不含票號。
3. **複製分享連結**：連結的 `#ballot=` 後面是同一份投票。同事把連結或 JSON 交給負責彙總的人。

負責彙總的人打開投票頁下方「工作人員：合併多人投票」，匯入每個人的 JSON 或貼上分享連結。完全相同的檔案只算一次。其他日期的檔案不會算進目前選的那一天。確認張數後下載 `vote-summary-YYYY-MM-DD.json`，需要留底再放到 `data/votes/`。

請每人交最新的一份。同一人先後交了兩版不同內容時，離線彙總會看成兩張票；彙總的人可按「移除」去掉舊的那份。試算表那一條則會覆寫同一張票，不會把改票算成兩個人。

### Formspree 與試算表各做什麼

兩條可以同時開，也可以只開一條。網址都填在 `docs/config.js`，留空的那條不會被呼叫。

| | Formspree | Google 試算表 |
| --- | --- | --- |
| 角色 | 收件匣／備份 | 頁面上團隊累計的來源 |
| 同事打開連結時 | 頁面數字不變 | 立即看到當時的贊成、反對與備註 |
| 有沒有登入 | 沒有 | 沒有 |
| 設定欄位 | `formspreeEndpoint` | `tallyEndpoint`（`sheetEndpoint` 是別名） |

頁面會在這台瀏覽器的 localStorage 放一組隨機票號（UUID）。它不是姓名、部門或信箱，只用來讓同一台瀏覽器改票時覆寫舊列。換瀏覽器或清掉網站資料會變成另一張票。

**Formspree**

1. 在 Formspree 建一張表單，確認它不要求填信箱。
2. `formspreeEndpoint` 填表單端點，形如 `https://formspree.io/f/xxxxxxxx`。
3. 只填 Formspree、不填試算表時，頁面維持本機計數，並出現「送到 Formspree」。送出的欄位是日期、票號、投票 JSON，沒有姓名。
4. 試算表也有填時，每次表態會一併把同一份內容送到 Formspree，不必再按一次。

舊設定仍可用：`submitMode` 填 `formspree`、網址填在 `submitEndpoint`。新的表單請改填 `formspreeEndpoint`。

**Google 試算表（團隊累計）**

手動部署步驟也寫在 `optional/google-apps-script/Code.gs` 檔首。摘要如下：

1. 建立空白 Google 試算表。用該試算表的 **擴充功能 → Apps Script** 貼上 `Code.gs`。不要另開獨立指令碼，否則腳本找不到這張表。
2. **部署 → 新增部署 → 網頁應用程式**。執行身分選 **我**，存取權選 **任何人**。不要選「任何人（Google 帳戶）」，否則同事會被導去登入，頁面讀不到數字。
3. 複製以 `/exec` 結尾的網址，貼到 `tallyEndpoint`。`sheetEndpoint` 可留空。
4. 用瀏覽器打開 `網址?date=2026-11-05`。應看到 JSON，例如 `{"ok":true,"date":"2026-11-05","ballots":0,"results":[]}`，而不是 Google 登入頁。
5. 同事打開 `https://smbmktd-cmd.github.io/ingredient-scout/?date=當天`。頁面上方出現「團隊累計」，每張卡片上也有該原料的贊成與反對。表態後約一秒會寫進試算表，並重新讀取累計。每隔約 25 秒會再讀一次。
6. 之後若改了 `Code.gs`：**部署 → 管理部署 → 鉛筆 → 版本選新版本 → 部署**，網址可以不變。若按的是「新增部署」，網址會換，`tallyEndpoint` 要一起換。只合併程式、不發新版本時，線上的 `/exec` 仍是舊碼。

試算表第一列會自動寫成 `receivedAt`、`ballotId`、`date`、`ingredientId`、`choice`、`note`。`date` 在寫入前會把整欄設成純文字，避免 Google 試算表把 `YYYY-MM-DD` 自動轉成日期。若格子裡已經是日期，讀回時用試算表時區（沒有則 Asia/Taipei）轉回日曆日，不用 UTC 的 `toISOString`，否則台北的午夜會被算成前一天，團隊累計會一直是 0。`receivedAt` 仍是 ISO 時間。POST 的本文是 `{kind,date,ballotId,votes:[{ingredientId,choice,note}]}`，而且是這張票當天的完整內容。同一票號再投會覆寫，不會永遠追加一列；這次沒帶的原料會從這張票拿掉。GET `?date=YYYY-MM-DD` 回傳 `{ok,date,ballots,results:[{ingredientId,approve,oppose,notes}]}`。同一張票對同一原料只算最新一列。這個 JSON 不含票號。

舊的五欄表（還沒有 `ballotId`）會在第一次新票寫入時自動補上票號欄。那些舊列沒有票號，每一列會先各算一張，避免整批被丟掉。

**跨網域：** Apps Script 的 `ContentService` 不能自訂 CORS 標頭。實際請求是兩段：瀏覽器先 `POST`（`Content-Type` 必須是 `text/plain`，避免 OPTIONS 預檢），Apps Script 回 **302**，`Location` 指向 `script.googleusercontent.com/macros/echo`。瀏覽器再 **GET** 那個 echo 網址，才讀得到 JSON。302 與 echo 都會帶 `Access-Control-Allow-Origin: *`。投票頁用 `redirect: "follow"` 走完這兩段；若程式自己還看得到 302 與 `Location`，會改對 echo 發 GET，不會再 POST。不要用 curl 之類會把 `Content-Type` 留在第二段 GET 的客戶端硬跟轉址，那樣會拿到 HTML 錯誤頁。讀取若仍失敗，才改帶 `callback` 用 JSONP。存取權不是「任何人」時，這兩種都讀不到。公開網址必須是 https。只有 `localhost` 與 `127.0.0.1` 可以用 http，方便在自己的電腦接一個試算表替身。

`submitMode` 填 `webhook`、網址填在 `submitEndpoint` 的舊設定，仍會被當成試算表網址。新的部署請填 `tallyEndpoint`。

收集端網址會寫在公開的 JavaScript 裡。知道網址的人都能送資料、也能讀走當天的累計與備註。它是方便用的共同計票，不是門禁。不要在備註留下可以認出個人的內容。

不要改用 GitHub Issue 收集投票。Issue 會帶出送出者的 GitHub 帳號，就不是匿名表態。

### 部署後怎麼自己看一次

自動檢查涵蓋改票覆寫與計票，但不會真的連上你的 Google 或 Formspree。網址填好並發布 Pages 之後：

1. 用一般瀏覽器視窗打開當日連結，對一筆原料按贊成。卡片上的「團隊累計」與上方的表應在同步後增加。
2. 用無痕視窗打開同一個連結。應看到剛才那一票，而本機數字仍是 0。再投一票反對，兩邊重新整理後，贊成與反對各自加總。
3. 回到第一個視窗改按反對。試算表應只留該票號的新選擇，團隊累計的贊成減一、反對加一，而不是變成兩張票。
4. 若有填 Formspree，收件匣應有同一天的備份，內容含票號與投票 JSON，沒有姓名欄。

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

檢查包含：必填欄位、TFDA 狀態、練習檔是否仍標成虛構、正式日報是否為 5 筆、`docs/catalog.js` 是否與 `data/` 一致、投票的改票、分享碼與彙總是否會把同一份檔案算成兩票，以及試算表計票是否會把同一張匿名票的改票算成兩票。`Code.gs` 裡的計票區塊必須與 `scripts/lib/sheet-tally.js` 相同。這道檢查不會連上 Google 或 Formspree；那兩段的手動步驟見上方「部署後怎麼自己看一次」。

# 資料欄位

投票頁讀的是 JSON。原料一筆一個檔，放在 `data/ingredients/<id>.json`。某一天要投的名單放在 `data/days/YYYY-MM-DD.json`。欄位代碼以 `data/schema.json` 為準，檢查腳本會對它。

空白底稿：`templates/ingredient.blank.json`、`templates/day.blank.json`。研究時先用 `templates/ingredient-dossier.md`。

## 原料

| 欄位 | 必填 | 說明 |
| --- | --- | --- |
| `id` | 是 | 小寫英文、數字、連字號。檔名必須是 `<id>.json`。 |
| `example` | 是 | 虛構練習檔為 `true`。練習檔的 TFDA 狀態只能是 `example_only`，名稱、商品名、學名、效益與劑量都要出現「虛構」，來源網址只用 `example.com`。 |
| `names.commonZh` | 是 | 中文俗名。 |
| `names.commonEn` | 是 | 英文俗名。 |
| `names.trade` | 是 | 商品名。沒有商品名就寫「無獨立商品名」與原因。 |
| `names.scientific` | 是 | 學名。不適用時寫原因，不要留空字串。 |
| `supply.supplierName` | 是 | 供應商名稱。 |
| `supply.supplierCountry` | 是 | 供應商國家。 |
| `supply.relationship` | 是 | `direct` 直接對台、`taiwan_agent` 台灣代理、`taiwan_distributor` 台灣經銷、`supplier_is_taiwan` 供應商在台灣、`unknown` 尚未確認。 |
| `supply.taiwanPartyName` | 是 | 台灣代理或經銷的名稱。關係是代理或經銷時不可空白。沒有窗口就改用其他關係代碼。 |
| `supply.relationshipNote` | 是 | 來源之間是否一致、還缺什麼證明。 |
| `tfda.usable` | 是 | 見下方狀態。 |
| `tfda.evidenceNotes` | 是 | 給投票的人看的短註記：查了什麼、結果是什麼、還有什麼限制。 |
| `tfda.lookupDate` | 是 | `YYYY-MM-DD`。 |
| `tfda.lookupToolUrl` | 是 | 保持 `https://yoyosu890524-byte.github.io/tfda-lookup/`。 |
| `tfda.queries` | 是 | 至少一筆。每筆含 `tab`（`ingredient`、`additive`、`history`）、`keyword`、`category`、`resultCount`（整數或 `null`）、`matchedName`、`restrictionNote`、`unconfirmedSafety`、`note`。 |
| `tfda.officialCrosscheck` | 是 | 兩個官方網址維持範本裡的值。`done` 為布林。做成「有列名」或「未確認不得使用」時，`done` 必須是 `true`。 |
| `efficacy.claimedBenefits` | 是 | 字串陣列。寫成宣稱，並讓讀者知道句子來自哪裡。 |
| `efficacy.suggestedDosage` | 是 | 建議劑量原文或摘要。 |
| `efficacy.dosageNote` | 是 | 這是供應商建議、文獻劑量，還是法規上限。 |
| `patent.status` | 是 | `yes`、`no`、`unknown`。`yes` 時 `refs` 至少一筆。沒查過用 `unknown`。 |
| `patent.refs` | 是 | 陣列，可為空。 |
| `patent.note` | 是 | 查詢範圍或尚未查的原因。 |
| `literature.status` | 是 | `yes`、`no`、`unknown`。`yes` 時 `refs` 至少一筆。 |
| `literature.refs` | 是 | 陣列，可為空。 |
| `literature.note` | 是 | 說明。 |
| `evidenceLevels` | 是 | 陣列，值可為 `in_vitro`、`cell`、`animal`、`clinical`。沒有資料就空陣列。含 `clinical` 時文獻狀態必須是 `yes`。 |
| `images` | 是 | 陣列。每筆含 `url`、`localPath`、`caption`、`source`（`official_site`、`exhibition`、`other`）。本地檔放在 `docs/assets/`，路徑寫 `assets/...`。 |
| `sources` | 是 | 至少兩筆。每筆含 `title`、`url`、`publisher`、`channel`、`accessed`、`whatItContributes`。 |
| `discovery.channel` | 是 | 這筆原料的主管道：`news`、`exhibition`、`industry_report`。 |
| `discovery.scoutDate` | 是 | 偵察日。 |
| `discovery.notes` | 是 | 怎麼從第一個來源追到其他來源。 |

來源的 `channel` 可以比主管道更廣：`news`、`exhibition`、`industry_report`、`supplier_site`、`paper`、`patent`、`other`。

### TFDA 狀態

| 代碼 | 意思 |
| --- | --- |
| `listed_food_ingredient` | 食品原料查詢有這一筆，且不是「未確認安全性」分類。仍要抄限制。 |
| `unconfirmed_not_for_food_use` | 畫面出現未確認安全性、尚不得作為食品原料。 |
| `listed_food_additive` | 食品添加物規格有這一筆。使用時要符合範圍與限量。 |
| `not_found` | 原料與添加物都沒有這一筆。這不是准用，也不是禁用結論。 |
| `lookup_blocked` | 助手或官方頁打不開，這次還沒查完。 |
| `needs_review` | 多筆近似，或原料與添加物都命中。 |
| `example_only` | 只給虛構範例使用。 |

## 當日名單

`data/days/YYYY-MM-DD.json`

| 欄位 | 說明 |
| --- | --- |
| `date` | 與檔名相同。 |
| `example` | 練習日報為 `true`，而且 `picks` 只能引用練習原料。 |
| `title` | 顯示在日期選單。 |
| `targetCount` | 正式作業目標是 5。 |
| `channelsCovered` | 這一天的主管道有哪些。 |
| `notes` | 寫在日報資料裡，投票頁不顯示。 |
| `picks` | 原料 id 陣列。正式日報要剛好 5 筆，且不能混入 `example: true` 的原料。 |

## 投票檔

同事從投票頁下載的檔案：

- `kind` 為 `ingredient-scout-votes`
- `anonymous` 為 `true`
- `votes[]` 只有 `ingredientId`、`choice`（`approve` 或 `oppose`）、`note`、`updatedAt`
- 沒有姓名、信箱、帳號欄位。檢查程式會拒絕這類欄位。

工作人員彙總後可另存 `data/votes/YYYY-MM-DD.json`，`kind` 為 `ingredient-scout-vote-summary`。這個資料夾目前只有佔位檔，彙總結果由同事在需要留檔時再提交。

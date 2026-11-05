# 參與方式

這個儲存庫用來蒐集原料、讓同事匿名表態。改資料時請走拉取請求。

1. 新原料複製 `templates/ingredient.blank.json`，檔名與 `id` 相同。
2. 研究步驟用 `templates/ingredient-dossier.md`。TFDA 用查詢助手或官方頁手查，不要另寫爬蟲。
3. 當天約 5 筆，寫進 `data/days/YYYY-MM-DD.json`。正式日報不要引用檔名以練習用途標成 `example: true` 的原料。
4. 在專案根目錄執行：

   ```bash
   node scripts/build-catalog.mjs
   node scripts/validate.mjs
   ```

5. 投票頁、下載的 JSON、卷宗與提交說明都不要出現同事姓名、電話或信箱。
6. 虛構練習資料必須一眼看得出是虛構：名稱含「虛構」，TFDA 狀態維持 `example_only`。不要把練習檔改成已核准。

不會用指令列時，把填好的 JSON 交給會提交的同事，由對方產生 `docs/catalog.js` 再一起送出。投票頁直接改 `docs/catalog.js` 會在下一次檢查時被退回。

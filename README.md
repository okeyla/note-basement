# QuickNote 備忘錄

用密碼保護的個人備忘錄單頁網站。備忘錄存在 Supabase 資料庫，全程只走一般的 HTTPS。

## 使用方式

開啟網站後先輸入密碼解鎖，沒有密碼什麼都看不到。

- **新增**：按「＋ 新增」，填標題、內容、類別，選「公」或「私」後儲存。標題和內容至少要填一項。
- **修改**：點任一張便利貼或清單項目就會開啟編輯視窗。`Ctrl + Enter` 可以直接儲存。
- **刪除**：在編輯視窗或清單右側按「刪除」。刪除後無法復原。
- **瀏覽**：右上角可以切換「便利貼」和「清單」兩種檢視，選擇會記在這台電腦。
- **篩選**：可以搜尋標題、內容、類別，用「全部／公／私」篩選，或點類別標籤只看某一類。
- **類別**：自由輸入，輸入時會提示已經用過的類別。同一類別的便利貼底色相同。

「公／私」只是用來篩選的標籤，兩者都要密碼才看得到。

「✨ AI 分類」按鈕目前還沒接上 AI 服務，按了會提示手動輸入；之後接上時只需要改後端的 `classify`。

## 注意事項

- 知道密碼的人可以看到、修改並刪除所有備忘錄。
- 同一個網路位址在 15 分鐘內輸錯密碼 10 次，會被鎖 15 分鐘（和 QuickDrop 共用計數）。
- 「在這台電腦記住」會把密碼存在瀏覽器裡，公用電腦不要勾；右上角「鎖定」可以清除。
- 兩個裝置同時修改同一則備忘錄時，後儲存的會蓋掉先儲存的。

## 架構

- `index.html`、`style.css`、`icon.svg`：純靜態前端，放 GitHub Pages 即可。後端網址寫在 `index.html` 的 `SUPABASE_URL`。
- 後端和 [QuickDrop](https://github.com/okeyla/quick-drop) 共用同一個 Supabase 專案（免費方案的專案數量有限），沿用它的 `config`、`auth_failures` 資料表，以及它每天一次的 keepalive 排程。
- `supabase/migrations/001_notes.sql`：`notes` 資料表。開啟 RLS 且沒有任何 policy，瀏覽器無法直接讀寫。
- `supabase/functions/notes/index.ts`：Edge Function，驗證密碼後讀寫備忘錄。部署時要關閉 JWT 驗證（函式自己做密碼檢查）。

## 設定密碼

資料庫只存密碼的 SHA-256。在 Supabase 的 SQL Editor 執行（把 `你的密碼` 換掉）：

```sql
insert into public.config (key, value)
values ('notes_password_sha256', encode(sha256(convert_to('你的密碼', 'UTF8')), 'hex'))
on conflict (key) do update set value = excluded.value;
```

要換密碼時再執行一次即可。

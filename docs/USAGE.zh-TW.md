# 使用說明

[English](USAGE.md) | **繁體中文**

怎麼安裝、每天怎麼用、怎麼設定和排錯。設計理由在 [ARCHITECTURE.zh-TW.md](ARCHITECTURE.zh-TW.md)。

## 0. 開始之前

- **需求**：Node.js 18 以上、git、最新版 Claude Code（終端機版執行 `claude update`；VS Code 擴充套件從擴充套件頁面更新）。套件用到的 hook exec 形式、skill 的 `effort` 與 `context: fork`、worktree 都是較新的功能。
- **平台**：Windows（原生或 WSL）與 Linux。所有腳本都是 Node，不需要 bash、jq 或 Python。macOS 沒有測過。
- **套件放哪裡**：任何 repo 以外的資料夾，例如 `D:\tools\solo-ai-team`。放進專案的 repo，它就會出現在 `git status`。程式裡沒有寫死任何路徑；安裝完成後 Claude Code 不會再讀取套件資料夾，只有重新安裝或更新時才需要它。
- **兩種指令**：安裝指令（`node install.mjs`、`node selftest.mjs`）在套件資料夾執行；檢查指令（`node .solo/engine/…`）在專案資料夾執行。下面的 `D:\work\team-app` 代表你的專案根目錄（有 `.git` 的那一層）。在 WSL 裡指令相同，路徑改成 Linux 寫法，例如 `~/work/team-app`。
- **個人偏好模板**：`kit/templates/CLAUDE.user.md` 是作者的個人偏好（用繁體中文回覆、說「教我」進入學習模式），第一次安裝會變成 `~/.claude/CLAUDE.md`。已經有這個檔案時不會覆蓋，只會另存成 `~/.claude/CLAUDE.solo-suggested.md` 讓你自己合併。

## 1. 每台電腦做一次

```powershell
git clone https://github.com/yapeepee/workflow.git D:\tools\solo-ai-team
cd D:\tools\solo-ai-team
node selftest.mjs              # 應該顯示 82/82 passed
node install.mjs --user-only   # skills、子代理、狀態列、個人 CLAUDE.md → ~/.claude
```

已經有的 `~/.claude/CLAUDE.md`、自己的 statusline、同名的 skill 都不會被覆蓋，安裝程式只會提示你手動合併。公司電腦不方便登入 GitHub 時，用 zip 把資料夾複製過去也可以。

建議再裝 code intelligence plugins：裝了之後，Claude 每次編輯完就能看到型別錯誤，不用等一輪結束的檢查。

```powershell
npm install -g typescript-language-server typescript   # TypeScript、Angular、React
dotnet tool install --global csharp-ls                 # C#（有 .NET 專案才需要）
```

接著在 Claude Code 裡執行 `/plugin install typescript-lsp@claude-plugins-official`；有 C# 專案的話，再執行 `/plugin install csharp-lsp@claude-plugins-official`。TypeScript 的 language server 不檢查 Angular 範本，範本錯誤仍然由 Stop hook 的 `ngc` 負責；VS Code 裝了 Angular Language Service 的話，Claude 也能用 `getDiagnostics` 讀到 Problems 面板裡的範本錯誤。

如果你在 WSL 裡用 Claude Code，這一節也要在 WSL 裡做：Windows 和 WSL 各有一個 `~/.claude`，兩邊不共用。

## 2. 既有專案（包括團隊共用的 repo）

| 步驟 | 指令 | 要確認的事 |
|---|---|---|
| 0. 裝好依賴（專案資料夾） | `npm ci`（.NET 用 `dotnet restore`） | 專案本身要能 build，檢查才有意義。複製專案時不要連 `node_modules` 一起複製 |
| 1. 預覽（套件資料夾） | `node install.mjs "D:\work\team-app" --dry-run` | 列出會建立的檔案，不寫入任何東西 |
| 2. 安裝（套件資料夾） | `node install.mjs "D:\work\team-app"` | 團隊 repo 會顯示 `Mode: shared repo`，最後一行是 `git status: unchanged` |
| 3. 讀 Notes | — | 缺少的工具（ESLint、測試框架、Prettier 設定檔）和不完整的 `node_modules` 都會列在這裡；缺得越多，自動檢查能做的就越少 |
| 4. 完整檢查（專案資料夾） | `node .solo/engine/check.mjs --stage full` | 全部 PASS 就可以開始工作 |
| 5. 專案本來就有錯誤 | `node .solo/engine/check.mjs --update-baseline` | 舊錯誤記成已知問題，之後只擋新出現的錯誤 |
| 6. 建立架構規則 | `/architecture` | 主 session 自己讀完整個專案，寫出 `.solo/architecture.md`（規則、每種改動的標準做法和參考檔案、已知例外）；這份檔案在你核准後才寫入，健檢報告和改善項目則直接寫進 `.solo/`。它也會提議 `CLAUDE.local.md` 的 TODO 要怎麼填。這一步會用掉很多 context，做完先 `/clear` |
| 7. 產品規則（個人專案） | `/product` | 用訪談建立 `.solo/product.md`：角色、核心流程、產品規則、不做的事。團隊的專案可以跳過 |
| 8. 開始工作 | 用 VS Code 開專案根目錄（或在根目錄執行 `claude`），輸入 `/spec <需求>` | 團隊的 `CLAUDE.md` 會和你的 `CLAUDE.local.md` 一起載入，套件不會動團隊的檔案 |

`CLAUDE.local.md` 一定會有一條規則：沒有你明確要求就不 commit、不 push。共用 repo 還會多一條：照團隊既有的慣例寫，不在程式碼裡加套件專用的註解。

選擇性設定（`.solo/config.json`）：

- UI 專案可以開 token-guard：`"tokenGuard": { "enabled": true }`。page builder 這類會正當使用 `[style.*]` 綁定的專案，要把 `styleBinding` 關掉：`"tokenGuard": { "enabled": true, "rules": { "styleBinding": false } }`。
- 裝了 Playwright 的話，把 `ui.enabled` 設成 `true`，`/check` 和 `/ship` 就會截圖當證據。

之後補裝了 ESLint、Prettier 設定或測試框架，在套件資料夾執行 `node install.mjs "D:\work\team-app" --reconfigure`。

## 3. 全新專案

先用框架的 CLI 建立專案，並在一開始就裝好 lint、格式化和測試，最後才安裝套件：安裝程式只會接上已經存在的工具。

```powershell
# Angular（ng new 會自動建立 git repo）
ng new shop; cd shop
ng add angular-eslint
npm i -D prettier
Set-Content .prettierrc '{}' -Encoding ascii

# React（Vite）
npm create vite@latest shop -- --template react-ts; cd shop
npm i -D vitest prettier
Set-Content .prettierrc '{}' -Encoding ascii
git init

# ASP.NET Core
dotnet new sln -n Shop
dotnet new webapi -o Api
dotnet new xunit -o Api.Tests
dotnet sln add Api/Api.csproj Api.Tests/Api.Tests.csproj
git init
```

- `.prettierrc` 是告訴安裝程式「這個專案用 Prettier」的訊號；沒有它，編輯後自動格式化會保持關閉。`-Encoding ascii` 是為了避免舊版 PowerShell 在檔案開頭寫入 BOM；在 WSL 裡改用 `echo '{}' > .prettierrc`。
- Angular 專案請確認 `angular.json` 裡有 `test` target，沒有的話完整檢查不會跑測試。

| 步驟 | 做法 |
|---|---|
| 1. 安裝（套件資料夾） | `node install.mjs "D:\work\shop"`（換成新專案的路徑） |
| 2. 完整檢查（專案資料夾） | `node .solo/engine/check.mjs --stage full`；新專案應該全部 PASS，不需要 baseline |
| 3. 產品規則和第一批決定 | 執行 `/product`，用訪談建立 `.solo/product.md`；在 `.solo/decisions.md` 寫下框架版本、狀態管理方式、樣式策略。`/spec` 規劃時會讀這兩份 |
| 4. 從第一天開 token-guard | 在 `.solo/config.json` 加上 `"tokenGuard": { "enabled": true }`，並在 Tailwind v4 的 `@theme` 定義 token；新專案沒有舊違規，這是成本最低的時機 |
| 5. 第一個任務 | 做一個最小的端到端功能（例如一個頁面加一支 API），確認 `/spec` → plan mode → `/phase` → `/ship` 在這個專案跑得通 |
| 6. 把第一個功能變成標準做法 | 執行 `/architecture`：它把這個功能寫成第一批規則和參考檔案，之後的功能都照著做 |

如果先安裝套件、之後才建立專案，執行一次 `node install.mjs "<repo>" --reconfigure`。

## 4. 一個任務的流程

`/spec` 會判斷任務大小，下一步依大小不同：

```
S（一小時內，只動一個區塊）
  /spec → 實作 → /check → /ship

M（動到幾個檔案或模組）
  /spec → /clear → Shift+Tab 進 plan mode → 你核准 phase 計畫
        → /phase（每個 phase 一次）→ /ship → /learn

L（跨模組，或超過一天）
  /spec 會先把它拆成幾個 M 任務

專案層（偶爾做）
  /product       產品規則（P1…）：誰在用、核心流程、不做的事
  /architecture  架構規則（A1…）、每種改動的標準做法和參考檔案
  每個任務的 /spec、/phase、/ship 都會對照這兩份
```

除了 phase 計畫之外，你只在兩個地方核准：M/L 任務的任務卡，以及需要新架構做法的時候（新的做法、新的依賴、規則的例外）。要改驗收條件時，Claude 也會先問你。/spec 會在規劃前先做「架構影響」：每種改動照哪個標準做法、參考哪個檔案。architecture.md 還沒寫的時候，它會拿最接近的既有功能當參考檔案，並提議把這個做法加進去。

每個 `/phase`：只寫這個 phase 的測試 → 實作 → 檢查 → 這個 phase 的 diff 大或有風險時才 code review → commit → 在 plan.md 標記完成。`/ship` 在最後一個 phase 之後跑一次：完整檢查、test guard、`/secure`（整個分支的安全審查）、比對架構決策、寫 `ship.md`。

完整的例子（每一步由誰做、用哪個模型、你要看什麼）見 [ARCHITECTURE §3](ARCHITECTURE.zh-TW.md)。

### 做到一半要加或改需求

直接跟 Claude 說就好。Claude 會先判斷這個變更屬於哪一級，再照對應的方式處理：

1. **在目前 phase 的範圍內，而且不改變驗收條件**，例如調整文案：Claude 直接做，並在任務卡的 Change log 記一行，標明 `in scope`。
2. **會改變範圍或驗收條件**：Claude 先在任務卡的 Change log 記一行，修改受影響的驗收條件和對應的測試，再重排還沒開始的 phase。目前的 phase 會先做完、commit，除非新需求讓它白做。
3. **其實是一個新功能**：Claude 把它記進 `.solo/inbox.md`，之後再用 `/spec` 處理，不打斷目前的 phase。

Claude 不能自己修改驗收條件，只能提議、等你同意。改到產品規則時，也會一起更新 `product.md` 和 `decisions.md`。新 session 會自動帶入 Change log，所以 `/clear` 之後也不會忘記。

## 5. 情境與指令對照

| 情境 | 指令 | 會發生什麼 |
|---|---|---|
| 個人專案剛開始，或產品規則改了 | `/product [重點]` | 用訪談建立或更新 `.solo/product.md` |
| 剛接手一個既有專案，或想知道架構好不好 | `/architecture` | 主 session 讀完整個專案，寫出規則、標準做法和參考檔案，列出問題和可以改成機械檢查的規則；做完先 `/clear` |
| 想確認目前的改動有沒有偏離架構 | `/architecture check [base]` | 只比對改動和 `architecture.md`，列出違規、需要決定的新做法和過時的規則 |
| 要做新功能或修改需求 | `/spec <需求>` | 寫出任務卡和有編號、可以機械檢查的驗收條件，對照產品規則和標準做法；L 任務或需求模糊時，逐題訪談你；M/L 任務要你核准 |
| 做到一半要加或改需求 | 直接跟 Claude 說 | Claude 先分級（見 §4）：範圍內直接做；改到驗收條件先更新任務卡的 Change log 和測試；新功能記進 inbox |
| 不確定下一件做什麼 | `/spec`（不帶需求） | 從 `.solo/inbox.md` 挑三件事建議你 |
| M 任務要規劃 | `/clear`，再按 Shift+Tab | 新 session 自動載入任務卡；計畫是幾個短的 phase，核准後存成 `plan.md` |
| 做 M 任務的下一個 phase | `/phase` | 只寫這個 phase 的測試 → 照標準做法實作 → 檢查 → 對照參考檔案 → 需要時 code review → commit → 標記完成 |
| 單獨為一個 phase 先寫測試 | `/test-first [n]` | 另一個子代理先寫會失敗的測試（`/phase` 已經包含這一步）；你只要檢查測試名稱 |
| 遇到 bug | `/bugfix <症狀>` | 先重現問題、找出根因、加上回歸測試，最後才修 |
| 覺得做完了 | `/check` | 跑完整的 lint、型別檢查、測試和 build |
| 要交出去（最後一個 phase 之後） | `/ship` | 完整檢查、`/secure`、比對架構決策和 `architecture.md`、逐條對照驗收條件；共用 repo 只把 commit 計畫和 PR 說明寫進 `ship.md`，由你自己 commit |
| 想提早做安全審查 | `/secure [重點]` | 對照 `.solo/security.md` 仔細審整個分支；第一次會和你一起建立這份威脅模型 |
| 要 Claude 代為 commit 或開 PR | `/ship commit` 或 `/ship pr` | 每次 commit 和 push 之前都會先問你 |
| 任務結束 | `/learn` | 記錄這次的教訓；同一個錯誤（pattern）第三次出現時，改成機械檢查 |
| context 超過 60%，或要離開一小時以上 | `/handoff`，再 `/clear` | 進度寫進檔案，新 session 自動接上 |
| 想比較幾種做法 | `/proto <想法>` | 做 2 到 3 個丟棄式原型；選定方向後再走 `/spec` |
| 長時間的機械式工作（例如 migration） | `/goal <條件>` | Claude Code 內建；條件要寫明完成標準和最多幾輪 |
| 想自己寫程式、學新東西 | 對 Claude 說「教我」 | Claude 引導你寫，不直接給答案 |
| 每週一 | `/retro` | 找出這週最大的瓶頸，選一個改善實驗；比較出貨耗時、出貨前修掉的發現、出貨後才發現的 bug |
| 每週五 | `/sweep` | 刪除死碼和沒用的依賴；共用 repo 裡不 commit |
| 新模型推出之後 | `/refresh` | 刪掉已經不需要的規則 |

主 session 自己讀程式、做分析和設計，因為子代理啟動時只拿到任務說明，看不到你們的對話。需要全局資訊的旁支工作用 fork：`/subtask <任務>` 會繼承整段對話，而且沿用 prompt cache。子代理：`scout`（Sonnet，唯讀；只做窮舉搜尋，例如「所有用到 X 的地方」，它只回報位置和實際跑過的搜尋，不下結論）、`test-author`（沿用主模型；由 `/phase` 或 `/test-first` 呼叫，只寫一個 phase 的測試、不碰正式程式碼）、`security-reviewer`（沿用主模型；由 `/secure` 呼叫，仔細審整個分支）、`prototyper`（Sonnet；由 `/proto` 呼叫，一個方向一個）。

## 6. 不用下指令，會自動發生的事

- 每次編輯後，有 Prettier 設定的專案會自動格式化該檔案；在共用 repo 裡，只保留改動附近的格式化。
- 每一輪結束前，套件會檢查這一輪改過的檔案。檢查失敗時，Claude 會自己修，最多 3 輪；之後暫停，直到下一次編輯。PASS 訊息會顯示每一步花了幾秒。
- 測試被刪除、被註解掉、被加上 skip，或斷言變少時，Claude 會被擋一次並要說明理由；之後的 PASS 訊息會一直列出這些檔案。
- 失敗的原因只有依賴壞掉（例如 `node_modules` 沒裝好）時，不會擋 Claude，而是直接告訴你要執行哪個還原指令。
- Claude 發現和任務無關的問題時，會記進 `.solo/inbox.md`，不會當場處理。
- 開新 session、`/clear` 或 compact 之後，目前的任務卡（含 Change log）、目前的 phase 和進度會自動載入。
- 每個 session 和每個自訂子代理都會載入 `.solo/product.md` 和 `.solo/architecture.md`（由 `CLAUDE.local.md` 匯入）；內建的 `/code-review` 也會看到它們。還沒寫的時候，它們只有兩行，提示你用哪個指令建立。
- 狀態列一直顯示：`Opus · ctx 34% · 5h 23% (resets 14:00) · 7d 41% · main* · task:login-form`。

## 7. 額度與中斷

- 狀態列的 `ctx` 是這個 session 用掉的 context，`5h` 和 `7d` 是額度用量；50% 以上變黃、80% 以上變紅。`ctx` 到 60% 時，狀態列會提示你 `/handoff` 再 `/clear`。
- 模型：套件不指定 session 的模型，用 Claude Code 的預設（2026-09 時，Max 是 Opus 5.5、effort medium）。額度吃緊時用 `/model opusplan`（Opus 規劃、Sonnet 實作）。`/spec`、`/product`、`/architecture` 和 `/refresh` 設了 `model: opus`，不論 session 用哪個模型，它們都跑在 Opus 上。
- Max 5x 方案同時最多開 2 個實作 session，各自在自己的 worktree（`claude -w <name>`）。
- 同一件事糾正兩次還是不對時，執行 `/clear`，把學到的寫進新的 prompt 重來。
- Claude 開始繞圈子、做你沒要求的功能，或想修改測試時，按 Esc 中斷。

## 8. 安裝後檔案在哪裡、誰看得到

| 位置 | 內容 | 誰看得到 |
|---|---|---|
| `~/.claude/skills/`、`~/.claude/agents/` | 15 個 skill、4 個子代理 | 只有你；不在任何 repo 裡 |
| `~/.claude/CLAUDE.md`、`~/.claude/solo-statusline.mjs` | 個人偏好、額度狀態列 | 只有你 |
| `<repo>/.solo/` | engine、`config.json`、`rules/`、`ledger.json`、`decisions.md`、`inbox.md`、`product.md`（產品規則）、`architecture.md`（架構規則與標準做法）、`architecture-review-*.md`（健檢報告）、`security.md`（威脅模型）、任務狀態、log、baseline | 只有你（被 `.git/info/exclude` 排除） |
| `<repo>/CLAUDE.local.md` | 你對這個專案的指令 | 只有你（Claude Code 官方的個人檔名，同樣被排除） |
| `<repo>/.claude/settings.local.json` | hooks、模型、權限 | 只有你（Claude Code 官方的個人設定檔，同樣被排除） |
| `<repo>/.worktreeinclude` | 讓 `claude -w` 的 worktree 也拿到上面這些私有檔案 | 只有你（被排除；團隊已有這個檔案時不會建立） |
| `<repo>/<proto.dir>/`（Angular 例：`src/app/_proto/`） | `/proto` 的丟棄式原型；用到才會出現 | 只有你（被排除） |
| `<repo>/.git/info/exclude` | 上面這些路徑的排除規則（附加一段 `# solo-ai-team`） | 只有你（在 `.git/` 裡，git 從不 commit 或 push 它） |

- 團隊之後如果 commit 了自己的 `CLAUDE.md`、`.claude/settings.json` 或 `.claude/skills/`，你照常 pull 不會衝突，兩邊的設定同時生效。
- 代價：私有檔案不在 git 裡，沒有版本紀錄，也不會跟著你換電腦或重新 clone。`CLAUDE.local.md`、`.solo/product.md`、`.solo/architecture.md`、`.solo/decisions.md`、`.solo/ledger.json` 累積了內容之後，偶爾自己備份一份。
- git 把被 ignore 的檔案視為可以覆蓋：萬一隊友 commit 了同名的 `CLAUDE.local.md` 或 `.claude/settings.local.json`，你 `git pull` 時 git 會直接用他的版本蓋掉你的，不會提示。所以每次開 session 時，套件都會把這兩個檔案備份到 `.solo/backup/`；發現它們變成被追蹤的檔案時，會請 Claude 在第一句話告訴你，並且不再修改它們。
- Claude 在你要求下改的程式碼（功能、修 bug、測試）當然會留在工作目錄裡，這是工作本身；它們會出現在 `git status`，要不要 commit 由你決定。

## 9. 共用 repo 模式

安裝程式會看最近 200 個 commit：只要有不是你（依 `git config user.email` 判斷）的作者，就當成共用 repo，只有一位同事在寫的專案也算。也可以用 `--shared` 或 `--personal` 直接指定。安裝程式最後會印出 `Mode: shared repo` 或 `Mode: personal repo`。共用 repo 裡：

- `/ship` 預設是 `manual`：跑完檢查和 review 之後，只把檔案清單、commit 計畫和 PR 說明寫進 `.solo/tasks/<slug>/ship.md`，不執行任何會寫入的 git 指令。想讓 Claude 代勞，要明確下 `/ship commit`、`/ship pr` 或 `/ship direct`，而且 commit、push 仍然會先問你。
- `/phase` 在每個 phase 結束時，只把這個 phase 的 commit（檔案和訊息）寫進 `ship.md`，請你 commit 之後才做下一個 phase。
- `/sweep` 不 commit、不切分支，把每一組刪除和建議的 commit 訊息記在 `.solo/` 裡。
- 編輯後的自動格式化只保留落在改動附近的結果。格式化工具如果會改到沒人動過的行，檔案就還原成格式化前的內容，避免一行修改變成整個檔案的 diff。
- token-guard 不會要求在程式碼裡加 `token-guard-ignore` 註解；刻意保留的值在同一個 session 只報一次。
- `/learn` 升級出來的機械檢查只放在 `.solo/`；要改團隊的 lint 設定、CI 或測試時，只會給你建議。
- `/proto` 的原型放在被排除的資料夾，接到路由的那幾行在你選定方向後會還原。

如果 repo 已經追蹤了 `.solo/`、`CLAUDE.local.md` 或 `.claude/settings.local.json`，安裝程式會在寫入任何東西之前停下來，因為寫到那些路徑就會出現在 `git status`。

在共用 repo 裡要記得：

- Claude 不會 commit 或 push。commit 之前，先看 `ship.md` 和 `git status`。
- 套件的檔案全都被 git 排除，`git status` 裡只會出現你要 Claude 改的程式碼。
- Claude Code 內建的 `/verify` 和 `/run-skill-generator` 會在 repo 的 `.claude/skills/` 寫入檔案，在共用 repo 裡使用前要注意。

## 10. 維護與排錯

| 情況 | 指令 | 執行位置 |
|---|---|---|
| 補裝了 ESLint、Prettier 設定或測試框架 | `node install.mjs "D:\work\team-app" --reconfigure`（重新偵測 `stacks`，保留 tokenGuard、ship 等其他設定；舊檔備份成 `.solo/config.backup.json`） | 套件資料夾 |
| 別人也開始 commit 這個 repo | `node install.mjs "D:\work\team-app" --shared --reconfigure` | 套件資料夾 |
| 套件更新了 | `node install.mjs --user-only --force`，再對每個專案執行 `node install.mjs "D:\work\team-app" --force`（`CLAUDE.local.md`、`config.json`、rules、`product.md`、`architecture.md` 不會被覆寫；`settings.local.json` 會合併，舊版的套件 hook 會被換掉，你自己的 hook 保留；舊版寫入的 `opusplan` 會被移除，改用 Claude Code 的預設模型。舊版的 `CLAUDE.local.md` 只會補上兩行匯入，新版的 Workflow 另存成 `.solo/CLAUDE.local.suggested.md`：請 Claude「把 suggested 檔的 Map、Workflow 和 Compact instructions 合併進 CLAUDE.local.md，保留我加的行」） | 套件資料夾 |
| 手動跑快速檢查 | `node .solo/engine/check.mjs --stage stop --changed` | 專案資料夾 |
| 手動檢查測試有沒有變弱 | `node .solo/engine/test-guard.mjs --base auto` | 專案資料夾 |
| 看錯誤類別的趨勢和一再重複的錯誤 | `node .solo/engine/ledger.mjs list --since 30d` | 專案資料夾 |
| Stop hook 的某一步每輪都很慢（PASS 訊息會顯示秒數，例如每輪都超過 20 秒） | 把那一步從 `.solo/config.json` 的 `stop` 移到 `full`，只在 `/check` 和 `/ship` 時跑 | 專案資料夾 |
| 全專案稽核寫死的設計值 | `node .solo/engine/token-guard.mjs <files>` | 專案資料夾 |
| 結果出現 `ENV:`，或 `Cannot find module '...node_modules...'` | `npm ci`（.NET 用 `dotnet restore`）；這是依賴壞掉，不是程式碼的問題 | 專案資料夾 |
| 結果出現 `CHANGED FILES:`（檢查改到了檔案） | `git restore <那些檔案>`，再修正 `.solo/config.json` 裡那個指令 | 專案資料夾 |
| 某個檢查暫時跑不了（例如 `SUITE DID NOT RUN`：測試根本無法編譯） | 在 `.solo/config.json` 加上 `"disabledSteps": ["angular/test"]`，修好後再拿掉 | 專案資料夾 |

## 11. 換電腦

套件不在任何團隊 repo 裡，所以新電腦要自己帶過去：

1. 先確認公司允許用 Claude Code 處理公司的程式碼，也確認應該登入公司帳號還是個人帳號。
2. 安裝 Node.js 18 以上、git 和 VS Code，並在 VS Code 安裝 Claude Code 擴充套件。執行 `git config --global user.email <你在這個團隊用的信箱>`，安裝程式用它判斷 repo 裡有沒有別人的 commit。
3. 照 §1 把套件 clone 到 repo 以外的資料夾，跑 `selftest.mjs` 和 `install.mjs --user-only`。
4. 照團隊原本的方式 clone 專案，照 §2 安裝（先 `--dry-run`）。最後應該看到 `Mode: shared repo` 和 `git status: unchanged`。
5. 用 VS Code 開專案根目錄，在 Claude Code 面板輸入 `/spec <需求>`。

補充：

- **延續同一個專案**：專案層的私人檔案（`CLAUDE.local.md` 和 `.solo/`）不會跟著換電腦。先把舊電腦上的這兩樣複製到新 clone 的同一個位置，再執行安裝程式；加上 `--force` 會更新 engine，但不會覆寫你的設定、規則和筆記。
- **WSL**：VS Code 連到 WSL 時（左下角顯示 WSL），Claude Code 在 WSL 裡執行，個人層也要用 Linux 版的 Node 裝在 WSL 裡，專案也 clone 在 WSL 的檔案系統裡。
- **擴充套件與 CLI**：兩者共用同一套設定、skills 和 hooks。擴充套件自帶 Claude Code；想在 VS Code 的終端機輸入 `claude` 才需要另外安裝 CLI。狀態列顯示在終端機介面，擴充套件的圖形面板不一定會顯示它。
- **開在子資料夾**：VS Code 開在子資料夾（例如 `frontend/`）也能用：hooks 會往上找到套件，Claude 也會收到提醒，要從根目錄執行套件的指令。開在根目錄還是最單純。
- **公司管理設定**：如果公司用管理設定只允許公司的 hooks（`allowManagedHooksOnly`），自動檢查不會執行；`/check` 仍然可以手動執行。

## 12. 設定參考：`.solo/config.json`

| 欄位 | 用途 |
|---|---|
| `shared` | `true` 表示共用 repo（見 §9）；安裝時自動偵測 |
| `stacks[]` | 每個專案區塊一組設定：`name`、`root`（相對 repo 根目錄）、`files`（glob，相對 root） |
| `stacks[].format` | 每次編輯後對該檔案執行的格式化指令，`{file}` 會換成檔案路徑；`null` 表示關閉 |
| `stacks[].stop[]` | Stop hook 執行的快速檢查：`{ name, run, only?, timeoutSec?, baseline? }`；`{files}` 會換成這一輪改過的檔案 |
| `stacks[].full[]` | `/check` 和 `/ship` 執行的完整檢查 |
| `limits` | `outputLines`（交給 Claude 的錯誤行數上限，預設 30）、`stopRetries`（Stop hook 最多擋幾輪，預設 3）、各類 timeout |
| `review` | `minLines`（改動達到這個行數就要 review，預設 300）、`splitLines`（達到就建議拆 PR，預設 400）、`alwaysPaths`（碰到就一定 review 的路徑）、`ignore`（不計入行數的檔案，例如 lockfile） |
| `disabledSteps` | 暫時停用的檢查步驟，例如 `["angular/test"]`；`--reconfigure` 不會清掉它 |
| `testGuard` | `enabled`（預設 `true`）、`files`（哪些檔案算測試檔；預設涵蓋 `*.spec.ts`、`*.test.*`、`*Tests.cs`、`test_*.py` 等） |
| `ui` | `enabled`、`root`、`baseUrl`、`serve`、`routes`、`viewports`，給 `snap.mjs` 截圖用 |
| `tokenGuard` | `enabled`、`files`、`allow`、`rules`（`hexColor`、`colorFunction`、`inlineStyle`、`styleBinding`、`arbitraryValue`） |
| `ship` | `mode`：`manual`（只準備，不動 git；共用 repo 的預設）、`commit`（只在本機 commit）、`pr`、`direct`；`base`（比較基準，空白表示自動偵測） |
| `proto` | `dir`：`/proto` 放原型的資料夾（相對 repo 根目錄，安裝時已排除在 git 之外） |
| `ignore` | 不追蹤也不檢查的路徑 |

沒有被偵測到的專案類型，可以手動加一個 stack，例如：

```json
{ "name": "legacy-asp", "root": ".", "files": ["**/*.asp"], "format": null,
  "stop": [], "full": [{ "name": "smoke", "run": "node tools/smoke.cjs" }] }
```

## 13. 移除

**專案層**：刪掉 repo 裡的 `.solo/`、`CLAUDE.local.md`、`.worktreeinclude`（檔案開頭有 `solo-ai-team` 註記的才是套件建立的），以及 `proto.dir` 資料夾（如果用過 `/proto`）。`.claude/settings.local.json` 裡如果還有你自己的權限設定，只刪掉指向 `.solo/engine/` 的三個 hook；整個檔案都是套件寫的話就直接刪掉。最後把 `.git/info/exclude` 裡 `# solo-ai-team` 那一段刪掉。這些都不會影響團隊的 repo。

**個人層**：刪掉 `~/.claude/skills/` 裡的 15 個 skill 資料夾、`~/.claude/agents/` 裡的 4 個檔案和 `~/.claude/solo-statusline.mjs`，再從 `~/.claude/settings.json` 移除 `statusLine`。

# Solo AI Team

[English](README.md) | **繁體中文**

> 一人團隊的 Claude Code 工作流，一個 Max 5x 方案就用得起。
> **模型負責做，工具負責判定做對了沒，你負責決定做什麼、以及要不要收下成果。**

**TL;DR (EN).** A Claude Code setup (15 skills, 4 subagents, 3 hooks, a status line, a zero-dependency Node engine) that replaces "Claude says it's done" with "the checks say it's done", keeps the big picture in the main session (every session loads the project's product rules and architecture recipes), works through a task one phase at a time, makes every patch a decision on the record, reviews security as a whole against the project's own threat model, and installs privately so it works inside a repo your whole team pulls without showing up in git. Its selftest (89 checks) runs in CI on Ubuntu and Windows; the README says what is verified and what is not.

[![selftest](https://github.com/yapeepee/workflow/actions/workflows/selftest.yml/badge.svg)](https://github.com/yapeepee/workflow/actions/workflows/selftest.yml)

一套 Claude Code 設定：15 個 skill、4 個子代理、3 個 hook、一條狀態列，加上零依賴的 Node engine。它把「Claude 說做完了」換成「檢查說做完了」。安裝是私有的：在整個團隊都在 pull 的 repo 裡，它加進來的東西不會出現在 `git status`，不會被 commit，也不會被 push。

## 它解決什麼

| 故障 | 機制 | 在哪裡 |
|---|---|---|
| Claude 結束一輪時，剛寫的東西還有 lint、型別或測試錯誤 | Stop hook 對這一輪改過的檔案跑快速檢查；失敗就擋下，只把錯誤行交回去，最多 3 輪 | `hook-stop.mjs`、`check.mjs` |
| 計畫建立在子代理的摘要上，沒有人看過全局 | 子代理啟動時只拿到任務說明，看不到對話和已讀的檔案，所以計畫由主 session 自己讀程式來做；scout 只做窮舉搜尋，需要全局的旁支工作用 fork；`product.md` 和 `architecture.md` 由 `CLAUDE.local.md` 匯入，每個 session 和子代理都從同一份規則出發 | `CLAUDE.local.md`、`/spec` |
| 新功能各寫各的，沒照既有的架構 | `architecture.md` 列出規則、每種改動的標準做法和參考檔案；`/spec` 規劃前先做架構影響，需要新做法時先問你；`/phase` 對照參考檔案；`/ship` 檢查整個分支有沒有偏離 | `/architecture`、`/spec`、`/phase`、`/ship` |
| 需求在做的過程中改變，任務卡和測試跟程式脫節 | 三級分流：範圍內直接做；改到驗收條件，先更新任務卡的 Change log 和測試；新功能記進 inbox。Claude 不能自己改驗收條件；新 session 會帶入 Change log | `CLAUDE.local.md`、`hook-session-start.mjs` |
| 改動繞過結構補一下（special case、`as any`、吞掉錯誤），下一個 session 再照抄 | fit check：加補丁之前，Claude 先找出決定同一個概念的所有地方，再選擇照擁有者的位置寫、先用一個 phase 調整結構（`test-guard --structural` 確認斷言一個都沒變），或保留補丁並在 Known deviations 登記一行，之後的 session 都看得到；改動的行出現 suppression、空的 catch，或專案架構規則禁止的寫法時，patch guard 擋一次 | `CLAUDE.local.md`、`patch-guard.mjs`、`test-guard.mjs` |
| 大任務一跑好幾個小時，中間沒有任何 review 或 commit | `/phase` 照計畫一次做一個 phase：只寫這個 phase 的測試、檢查、只審這個 phase 的 diff，然後 commit | `/phase`、`check.mjs --review-gate --base HEAD` |
| 你的 review 時間是瓶頸 | 你只看任務卡、phase 計畫、測試名稱和證據；code review 只在某個 phase 改動達 300 行以上或碰到高風險路徑時才跑 | `/phase`、`/ship` |
| security review 只是例行掃過，什麼都沒找到 | `/secure`：對照專案自己的威脅模型，仔細審一次整個分支；每個發現都要附具體攻擊，報告也要列出驗證過的規則 | `/secure`、`security-reviewer` |
| 測試被用 skip、刪除或放寬的方式「修好」 | test guard 把測試檔和 HEAD 比較（測試變少、新增 skip/only、斷言變少、檔案被刪）；擋一次，之後持續標示給你看 | `test-guard.mjs` |
| 舊專案原有的錯誤淹沒新錯誤 | baseline 以錯誤訊息文字為 key、不看行號：只有新錯誤會擋 | `check.mjs --update-baseline` |
| `/clear` 或新 session 忘了做到哪裡 | 每次 session 開始都重新注入任務卡、目前的 phase 和進度 | `hook-session-start.mjs` |
| 同樣的錯誤一再出現 | ledger 按「同一個錯誤」（pattern）計數；第三次出現印出 ESCALATE：改成 lint rule、測試或 check step，再刪掉文字規則 | `ledger.mjs`、`/learn` |
| AI 工具滲進團隊 repo：`git status` 多了檔案、整檔被重排、被 commit | 透過 `.git/info/exclude` 私有安裝；共用 repo 裡不寫 git、格式化只留在你的改動附近、程式碼裡不留套件註解 | `install.mjs`、`hook-after-edit.mjs` |
| `node_modules` 壞掉，Claude 卻去「修」程式碼或改寫 lockfile | 這類失敗標成 `ENV`，連同還原指令交給你，而且永遠不記進 baseline | `check.mjs` |
| 會改檔案的檢查（`eslint --fix`）悄悄改了程式碼 | 安裝程式拿掉 `--fix`/`--write`/`-u`；runner 在每一步前後比對被追蹤的檔案，改到檔案的那一步以 `CHANGED FILES` 判定失敗 | `install.mjs`、`check.mjs` |
| 寫死的顏色和 px 繞過設計系統 | 選用的 token guard，只回報你改到的行 | `token-guard.mjs` |

## 快速開始

需要 Node.js 18 以上、git 和最新版 Claude Code（`claude update`）。支援 Windows（原生或 WSL）與 Linux，不需要 bash、jq 或 Python。

```bash
git clone https://github.com/yapeepee/workflow.git solo-ai-team   # 放在任何專案 repo 以外的地方
cd solo-ai-team
node selftest.mjs                          # 89/89 passed
node install.mjs --user-only               # 每台電腦一次：skills、子代理、狀態列 → ~/.claude
node install.mjs "<repo 根目錄>" --dry-run   # 預覽：列出會建立的每個檔案
node install.mjs "<repo 根目錄>"             # 每個 repo 一次；最後一行是 "git status: unchanged"
```

接著在 repo 裡執行 `node .solo/engine/check.mjs --stage full`（專案原本就有錯誤的話，先跑一次 `--update-baseline`），在 repo 根目錄開 Claude Code。既有專案先跑一次 `/architecture`，個人專案再跑 `/product`，然後從 `/spec <你要做的事>` 開始。全新專案、設定和排錯：[docs/USAGE.zh-TW.md](docs/USAGE.zh-TW.md)。

## 一個任務怎麼走

```
S  一個區塊，一小時內      /spec → 實作 → /check → /ship
M  幾個檔案或模組          /spec → /clear → plan mode（Shift+Tab）→ 你核准 phase 計畫
                           → /phase，每個 phase 一次 → /ship → /learn
L  跨模組，超過一天        /spec 先把它拆成幾個 M 任務

專案層（偶爾做）           /product：產品規則 · /architecture：架構規則、標準做法、參考檔案
                           每個任務的 /spec、/phase、/ship 都會對照這兩份
```

你要看的東西很少、而且槓桿最高：任務卡、phase 計畫、每個 phase 的測試名稱、檢查結果、安全審查報告和截圖。除了 phase 計畫之外，你只在兩個地方核准：M/L 任務的任務卡，以及需要新架構做法或結構調整的時候；要改驗收條件時，Claude 也會先問你。中間的步驟都由工具把關。

## 指令

| 指令 | 什麼時候 | 會發生什麼 |
|---|---|---|
| `/product [重點]` | 個人專案開始時；產品規則改變時 | 用訪談建立或更新 `.solo/product.md`：角色、核心流程、產品規則（P1…）、不做的事、待決問題 |
| `/architecture [check]` | 既有專案開始時；每隔一段時間 | 主 session 自己讀完整個專案，寫出 `.solo/architecture.md`：規則（A1…）、每種改動的標準做法和參考檔案、每個核心決定由哪個模組負責、已知例外；另外列出問題和可以機械化的規則。`check` 只比對目前的改動 |
| `/spec <需求>` | 任何不單純的工作之前 | 產生任務卡和有編號、可以機械檢查的驗收條件，對照產品規則和標準做法；大型或模糊的需求會逐題訪談；M/L 要你核准，需要新的架構做法先問你；不帶需求時從 `.solo/inbox.md` 挑 3 件建議 |
| `/phase [n]` | M 任務的每一個 phase | 只寫這個 phase 的測試 → 照標準做法實作，加補丁前先做 fit check → 檢查 → 對照參考檔案 → 這個 phase 的 diff 大或有風險時才 code review → commit → 標記完成 |
| `/test-first [n]` | 單獨為一個 phase 寫測試（`/phase` 已經包含這一步） | 另一個子代理先寫會失敗的驗收測試：出題的人不寫答案 |
| `/check` | 宣稱做完之前 | 透過精簡的 runner 跑完整的 lint、型別、測試和 build；有設定 UI 截圖就截圖 |
| `/secure [重點]` | `/ship` 會跑；想提早看時隨時可跑 | 對照 `.solo/security.md` 仔細審整個分支；第一次執行時會和你一起建立這份威脅模型 |
| `/ship [manual\|commit\|pr\|direct]` | 每個任務一次，在最後一個 phase 之後 | 完整檢查 → test guard → 審還沒 review 過的改動 → `/secure` → 比對架構決策、`architecture.md` 和補丁 → `ship.md`（驗收對照、PR 說明和一行量測紀錄）；共用 repo 的 git 由你自己動 |
| `/learn` | 任務結束 | 教訓以 pattern 記進 ledger；同一個錯誤第三次出現就升級成機械檢查 |
| `/handoff` | context 超過 60%，或要離開一陣子 | 進度寫進檔案；`/clear` 之後新 session 自動接上 |
| `/bugfix <症狀>` | 遇到 bug | 重現 → 根因 → 回歸測試 → 修正 |
| `/proto <想法>` | 比較幾種方向 | 平行做 2–3 個丟棄式原型；選中的再走 `/spec` |
| `/retro` | 每週 | 一個瓶頸、一個實驗；比較出貨耗時、出貨前修掉的發現、出貨後才發現的 bug |
| `/sweep` | 每週 | 小步刪除死碼和沒用的依賴，每步都驗證 |
| `/refresh` | 新模型推出後 | 刪掉只是在補舊模型弱點的規則 |

主 session 自己讀程式、做分析和設計；需要全局的旁支工作用 fork（`/subtask <任務>`），它會繼承整段對話。子代理：`scout`（Sonnet，唯讀；只做窮舉搜尋，回報位置和實際跑過的搜尋，不下結論）、`test-author`（和你的 session 同一個模型；只寫一個 phase 的測試，不碰正式程式碼）、`security-reviewer`（和你的 session 同一個模型；仔細審一次整個分支）、`prototyper`（Sonnet；一個方向一個丟棄式原型）。

模型：套件不指定 session 的模型，所以用 Claude Code 的預設（2026-09 時，Max 是 Opus 5.5、effort medium）。`/model opusplan`（Opus 規劃、Sonnet 實作）可以省額度。例外是四個分析類的 skill：`/spec`、`/product`、`/architecture` 和 `/refresh` 設了 `model: opus`，不論 session 用哪個模型（包括 `opusplan` 和 Fable），它們都跑在 Opus 上。

## 自動發生的事

| hook | 時機 | 做什麼 |
|---|---|---|
| PostToolUse | 每次編輯後 | repo 有 Prettier 設定時格式化該檔案（共用 repo 只保留改動附近的格式化）；選用的 token guard |
| Stop | Claude 結束一個有編輯的回合時 | 對改過的檔案跑快速檢查、test guard 和 patch guard；只帶錯誤行擋下，最多 3 輪；PASS 訊息會顯示每一步花了幾秒；改程式碼修不好的問題（依賴壞掉、會改檔案的檢查）改成交給你 |
| SessionStart | 啟動、resume、`/clear`、compact | 重新注入目前的任務卡（含 Change log）、目前的 phase 和進度；備份你的私有檔案，團隊開始追蹤它們時發出警告 |
| 狀態列 | 一直顯示 | `Opus · ctx 34% · 5h 23% (resets 14:00) · 7d 41% · main* · task:login-form` |

## 預設私有

skills 和子代理放在 `~/.claude`，從來不在 repo 裡。專案裡的檔案（`.solo/`、`CLAUDE.local.md`、`.claude/settings.local.json`、`.worktreeinclude`）透過 `.git/info/exclude` 隱藏；這是 git 每份 clone 自己的 ignore 清單，本身永遠不會被 commit。安裝程式從不修改被追蹤的檔案（連 `.gitignore` 也不改），從不執行會寫入的 git 指令；如果 repo 已經追蹤了上面任何一個路徑，它會在寫入任何東西之前停下來。

只要最近 200 個 commit 裡出現不是你（依 `git config user.email` 判斷）的作者，repo 就算**共用**。共用 repo 裡，`/phase` 和 `/ship` 只把要做的 commit 寫進 `ship.md`、git 交給你，`/sweep` 只記錄刪除、不 commit，格式化只保留在你改動的行附近，程式碼裡也永遠不會出現套件專用的註解。

## 目錄結構

```
solo-ai-team/
├─ install.mjs          安裝程式：不刪除任何東西、不修改被追蹤的檔案、不執行會寫入的 git 指令
├─ selftest.mjs         在丟棄式 git repo 裡跑 89 項檢查：engine、私有安裝、共用 repo 模式
├─ kit/
│  ├─ engine/           hooks、check runner、test guard、patch guard、token guard、ledger、snap、狀態列
│  │                    （Node，零依賴）→ <repo>/.solo/engine/
│  ├─ skills/           15 個 skill → ~/.claude/skills/
│  ├─ agents/           scout、test-author、security-reviewer、prototyper → ~/.claude/agents/
│  ├─ settings.json     hooks 和權限規則 → 合併進 <repo>/.claude/settings.local.json
│  └─ templates/        CLAUDE.local.md、個人 CLAUDE.md、decisions.md、inbox.md、product.md、architecture.md、
│                       框架規則（Angular、Angular legacy、React、.NET）
├─ docs/                USAGE（怎麼用）和 ARCHITECTURE（為什麼），英文與繁體中文
└─ .github/workflows/   在 Ubuntu + Windows × Node 18/22 跑 selftest
```

## 設計重點

1. **由工具判定「做完了」。** lint、型別、測試和 build 判定成果，模型只看到錯誤行。
2. **全局留在主 session。** 子代理只拿到任務說明，看不到對話；所以計畫由主 session 自己讀程式來做，子代理只負責搜尋、寫測試和 review 這類獨立的工作。`product.md` 和 `architecture.md` 寫規則不寫導覽，讓每個 session 都從同一份規則出發。
3. **小迴圈。** 任務規劃成幾個短的 phase，每個 phase 都測試、檢查、review、commit 完，才開始下一個。
4. **模型跟著判斷走，不跟著過時的價目表走。** 預設模型負責實作；寫測試和做安全審查的子代理沿用它；只有搜尋和丟棄式原型用 Sonnet；最常執行的判定交給不花 token 的腳本。
5. **安全要看全貌。** 以專案的威脅模型為基礎，像攻擊者一樣仔細審一次整個改動；不是例行掃描，也不拆成一片一片審。
6. **同一個錯誤出現三次，就改成機制。** 文字規則每個 session 都花 token，而且可能被忘記；同一個錯誤第三次出現，就變成 lint rule、測試或 check step，文字規則刪掉。
7. **記憶要小。** 私人的 `CLAUDE.local.md` 在 150 行以內，框架規則用匯入的，流程放在沒被呼叫就不花成本的 skill 裡。
8. **刪除是正式工作。** 每週 `/sweep`，每次新模型推出後 `/refresh`。
9. **在團隊 repo 裡不留痕跡。** 套件自己的檔案永遠不進 git，只有你要求時才寫 git，沒人改過的行永遠不會被重排。
10. **補丁是一個決定，對照架構來判斷。** 套件標出讓檢查閉嘴的寫法，其餘由專案的架構規則宣告。加補丁之前，Claude 先找出決定同一個概念的所有地方，再選擇：照擁有者的位置寫、先調整結構，或保留補丁並登記。同一個概念出現第三個例外，就代表結構該調整了。

這些重點背後的十條原則（做法出自哪裡 → 為什麼有效 → 套件怎麼做）：[docs/ARCHITECTURE.zh-TW.md](docs/ARCHITECTURE.zh-TW.md)。

## 已驗證 / 未驗證

**由 `selftest.mjs`（89 項）驗證**：在 Windows 11 原生環境通過，Node 22（2026-10-02；加入 patch guard 之前的 82 項也在 Linux 上通過，2026-09-29），之後每次 push 由 [CI](.github/workflows/selftest.yml) 在 Ubuntu + Windows × Node 18/22 執行。它會建立丟棄式的 git repo（路徑含空白、一個模擬的遠端、兩份 clone），讓 git 使用自己的空設定，並照 Claude Code 呼叫 hook 的方式驅動它們：`node <script>`，JSON 從 stdin 傳入。

- Engine：編輯後格式化；Stop hook 擋下 → 修正 → 通過 → 靜默；3 輪上限；PASS 訊息顯示每一步的秒數；不追蹤子代理的編輯；token guard 只看改動的行，以及共用模式下的行為；test guard（JS/TS、xUnit、pytest；被 skip、被註解、被刪除、被搬移的測試）；patch guard（只看改動的行、擋一次再持續標示、架構規則的 pattern 只在擁有者以外擋、自動產生的程式碼和 `patchGuard.allow` 不擋、CLI 看整個分支、測試檔交給 test guard）；`test-guard --structural`（斷言被改會回報，測試搬到別的檔案不算）；`ENV`、`CHANGED FILES`、`SUITE DID NOT RUN`、`disabledSteps`；baseline 在程式碼上下移動後仍然有效；review gate、拆分建議，以及只審一個 phase 的 `--base HEAD`；ledger 只在同一個錯誤重複時才升級；狀態列；SessionStart 注入任務卡、它的 Change log 和目前的 phase；hook 啟動程式從子資料夾找到套件，以及在沒裝套件的地方什麼都不做；經由 junction 或 symlink 開啟的 repo。
- 安裝程式：`git status` 不變、`.gitignore` 沒動、`git add -A` 不會加入任何檔案；每個 skill 和 agent 都裝好並帶有套件標記；隊友 commit 自己的 Claude 設定；重新安裝保留你自己的 hook，移除舊版套件寫死的模型、保留你自己選的模型；建立 `product.md` 和 `architecture.md` 並由 `CLAUDE.local.md` 匯入，舊版的 `CLAUDE.local.md` 只補上匯入、新版 Workflow（需求變更分流和 fit check）另存成建議檔；團隊開始追蹤 `CLAUDE.local.md` 時備份並警告；repo 追蹤了個人路徑時拒絕安裝；共用與個人模式的判斷；拿掉 `--fix`；依賴健康檢查；`--shared --reconfigure`；經由 junction 或 symlink 安裝。

**人工檢查過、不在 CI 裡（2026-09）**：在 Linux VM 裡的一個真實 Angular 22 專案（[ARCHITECTURE §15](docs/ARCHITECTURE.zh-TW.md)）；一個有 eslint、tsc、vitest 和 Prettier 的 TypeScript 專案；共用 repo 的格式化還原，用真的 Prettier 3；git 2.43 在 pull 時覆蓋被排除的檔案；8.3 短檔名：把 fixture 放在短檔名路徑下跑完整個 selftest；`/phase` 和 `/ship` 交給內建 `/code-review` 的目標（Claude Code 2.1.284，在丟棄式 repo 裡）：不給目標時，review 審到了還沒 push 的 commit，給了目標就只審還沒 commit 的修改和新檔案。

**沒有驗證的部分：**

- **模型那一端。** Claude 照著 skill 做時，寫出的任務卡、計畫、測試和安全審查好不好。fixture 量不到判斷力，只有實際使用量得到。
- **`/product`、`/architecture`、需求變更的三級分流和 fit check 在真實任務上的效果。** 它們的依據是 Claude Code 的文件（子代理看不到對話）和外部研究（見 [ARCHITECTURE §18 和 §19](docs/ARCHITECTURE.zh-TW.md)），還沒在真實任務上量過。
- **phase 迴圈和 `/secure` 在真實任務上的效果。** 兩者都是從一個真實專案的紀錄（四個里程碑）推出來的，selftest 只涵蓋它們在 engine 裡的部分。它們能不能縮短一個任務、`/secure` 能不能找到通用掃描漏掉的問題，要看 `/ship` 的量測紀錄和 `/retro`；目前還沒量。
- **真實的 Claude Code session。** selftest 重播 `kit/settings.json` 裡 hook 的 `command` 和 `args`，這就是 Claude Code 執行它們的方式，但終究是重播。
- **省下多少額度。** 目前沒有數字，請用 `/usage` 和狀態列自己量。
- **macOS。** 從沒跑過。

## 失敗紀錄 → 機制

這裡大部分的機制，都是因為某件具體的事出錯才加的。

- **Angular 的 template 錯誤躲過了 `tsc`**（實測，2026-09）。template 呼叫了不存在的 `title()`，`tsc --noEmit` 卻通過（約 23 秒）→ Angular 的 Stop hook 改跑 `ngc -p tsconfig.app.json --noEmit`，連 template 一起做型別檢查（約 41 秒）。
- **套件在真實 repo 裡留下了 `.git/index.lock`**（實測，2026-09）。VM 裡的 `git status` 和主機上的 git 搶鎖 → 套件的每個 git 讀取都加上 `GIT_OPTIONAL_LOCKS=0`，selftest 也檢查這一點。
- **在真實專案上 token guard 報了 132 筆，大多是誤判**（實測，2026-09）。`<style>` 區塊、`assets/`，以及 page builder 正當使用的 `[style.*]` 綁定 → `<style>` 當 CSS 檢查、`assets/**` 預設排除、`styleBinding` 可以關掉（132 → 37），而且編輯時只回報改動的行。
- **一個真實團隊的 lint script 帶著 `eslint --fix`**（2026-09）。拿來當檢查就會改寫團隊的檔案 → 安裝程式拿掉 `--fix`/`--write`/`-u`，runner 讓任何改到被追蹤檔案的步驟失敗（`CHANGED FILES`）。
- **git 在 pull 時沒問就蓋掉了私人檔案**（在 git 2.43 實測）。git 把被排除的檔案視為可以覆蓋，隊友 commit 同名檔案就會蓋掉你的 → SessionStart 把 `CLAUDE.local.md` 和 `settings.local.json` 備份到 `.solo/backup/`，一旦它們變成被追蹤的檔案就發出警告。
- **selftest 在真正用過 Claude Code 的電腦上崩潰**（2026-09-28，發佈前審查發現）。Claude Code 會把 `**/.claude/settings.local.json` 加進全域 git excludes，於是 fixture 的 `git add -A` 什麼都沒加：60/61，最後 7 項沒跑。在這種電腦上，「git status 為空」也不必靠安裝程式自己的 exclude 就會通過 → selftest 改讓 git 使用自己的空設定，並由 CI 在 Ubuntu 和 Windows 上執行。
- **在 Windows 上 clone 會弄壞規則模板**（2026-09-28，發佈前審查發現）。Git for Windows 預設 `core.autocrlf=true`，而安裝程式用以 `\n` 錨定的 regex 剝除模板的 front matter，CRLF checkout 就把 `paths: "{{ROOT}}…"` 帶進每個 session → `.gitattributes` 鎖定 LF，CI 遇到任何 CRLF checkout 就失敗。
- **CI 第一次在 Windows 上跑就失敗，31/52**（2026-09-28，第一次 CI）。runner 的暫存資料夾是 `C:\Users\RUNNER~1\…` 這種 8.3 短檔名，git 回報的卻是長路徑，所以沒有任何被編輯的檔案對應得到測試 repo。真實使用時，經由短檔名、junction 或 symlink 開啟的專案也會這樣：hook 靜靜略過每一次編輯，安裝程式的排除規則也對不上，套件直接出現在 `git status`。作者的使用者名稱夠短，本機從來不會產生短檔名 → 路徑看起來在 repo 外面時，engine 先比對 real path（`fs.realpathSync.native`）再下結論，安裝程式也用同樣的方式解析目標路徑，selftest 則加上經由 junction 或 symlink 開啟 repo 的檢查。
- **任務一跑好幾個小時，中間沒有任何 review**（一個真實專案，2026-09）。plan 有 24–54 KB；`/test-first` 一次寫完所有 phase 的測試，於是要做完五個 phase 才第一次編譯得過；最後才出貨，只好切成四刀，而 review gate 以 `origin/main` 為基準，每一刀都把前面審過的程式再審一次 → `/phase` 一次只做一個 phase，各自測試、review、commit；review gate 支援 `--base HEAD`；plan 限約 150 行。
- **通用的安全掃描跑了十多次都沒發現，真正的授權漏洞卻是 code review 抓到的**（同一個專案）。一個沒被受保護 layout 包住的畫面，不用登入就進得去 → `/secure` 每個任務對照專案的威脅模型仔細審一次整個分支，走攻擊者的完整路徑；每個發現都要附具體攻擊，報告也要列出驗證過的規則。
- **Haiku scout 漏算，而計畫就建立在它的摘要上**（同一個專案）。同一個檔案裡有 2 處，它只找到 1 處 → scout 改用 Sonnet，只回報位置和實際跑過的搜尋，不下結論；數量和「沒有別的地方用到」由主模型自己 grep 確認。
- **ledger 在 5 個類別觸發升級，只有 1 個真的變成檢查**（同一個專案）。只是同屬一類的教訓，無法用同一個檢查抓到，其中 3 個還被標成 enforced，說明寫的正是這件事 → 升級改成計算有名字的 pattern，也就是同一個錯誤；類別只用來看趨勢。
- **計畫建立在子代理的摘要上，而子代理從來看不到全局**（2026-09，對照 Claude Code 文件確認）。一般子代理啟動時只拿到自己的 prompt、任務說明、CLAUDE.md 和 git status，看不到對話，也看不到主模型讀過的檔案；內建的 Explore 和 Plan 連 CLAUDE.md 都不讀。換成更強的模型也補不回這一點 → 計畫由主 session 自己讀程式來做（Opus 5.5 在 Max 上有 1M context）；scout 只做窮舉搜尋；需要全局的旁支工作用 fork；產品規則和架構規則寫進由 `CLAUDE.local.md` 匯入的 `product.md` 和 `architecture.md`，每個 session 和每個自訂子代理都會載入。
- **驗收條件在實作中途被 Claude 自己改掉**（同一個專案）。實測結果和 spec 的假設不同時，Claude 直接修改了驗收條件和對應的腳本 → 需求變更改成三級分流，Claude 只能提議修改驗收條件；核准的變更記進任務卡的 Change log，新 session 會帶入。
- **套件把模型寫死在過時的價目表上**（2026-09）。`opusplan` 讓實作跑在 Sonnet 上，因為 Opus 以前貴很多，所以那個專案最初幾個里程碑很可能是 Sonnet 5 寫的 → 套件不再指定模型，改用 Claude Code 的預設；`test-author` 和 `security-reviewer` 沿用主模型；重新安裝時會移除舊的設定。
- **補丁一個接一個累積，檢查卻全部通過**（作者在大型專案和連續 session 裡的經驗；缺口是 2026-10 檢視套件時找到的）。special case、`as any`、吞掉錯誤，正是讓檢查變綠最便宜的方法，所以沒有任何檢查看得到它，ledger 也從來沒記過它。禁止它的規則只是文字，而且只在檢查失敗時才出現；下一個 session 再照抄這個補丁，因為補丁的理由在 `/clear` 之後就不見了 → 加補丁之前先做 fit check（照擁有者的位置寫、先調整結構，或保留補丁並在 Known deviations 登記一行），patch guard 檢查改動的行（包含從專案架構規則產生的 pattern），調整結構的 phase 由 `test-guard --structural` 把關。

## 演化來源

Solo AI Team 是 [agent-harnesses](https://github.com/yapeepee/agent-harnesses) 裡 [`claude-quality-harness-v3`](https://github.com/yapeepee/agent-harnesses/tree/main/claude-quality-harness-v3) 的後繼。它保留那個 harness 的核心原則（強模型在作者期、便宜模型加確定性程式在執行期），並套用在模型分工上：需要判斷的地方用強模型（計畫、測試、安全審查），搜尋用較便宜的模型，最常執行的檢查交給確定性的腳本。改變的是機制從哪裡來：v3 一開始就在每個專案上跑四個 review agent 和一套憲法；這裡要等 ledger 顯示同一個錯誤出現三次，才建立對應的機制。逐一元件的對照：[ARCHITECTURE §11](docs/ARCHITECTURE.zh-TW.md)。

## 文件

| 文件 | 看什麼 |
|---|---|
| [docs/USAGE.zh-TW.md](docs/USAGE.zh-TW.md) | 安裝；既有專案與全新專案；所有指令；自動發生的事；設定；排錯；移除 |
| [docs/ARCHITECTURE.zh-TW.md](docs/ARCHITECTURE.zh-TW.md) | 為什麼這樣設計：十條原則與出處、記憶分層、驗證、安全審查、額度預算、私有安裝、演化來源、實測、全局觀與需求變更、補丁與 fit check |

這些原則參考了 Claude Code 團隊與其他實務者公開的做法，ARCHITECTURE 列出了每一個出處。這是獨立專案，與 Anthropic 無關。

每份文件都有英文版和繁體中文版（`*.zh-TW.md`），頂端可以互切。給機器讀的檔案（skill 內文、agents、templates、engine 的輸出）用英文，模型解析最穩定。使用者呼叫的 skill，一行描述用繁體中文，因為那是作者在 `/` 選單裡看到的文字；`kit/templates/CLAUDE.user.md` 是作者的個人偏好（用繁體中文回覆、「教我」學習模式）。

## 授權

**All rights reserved.** 本 repo 以作品集形式公開，只供閱讀與評估；未經作者書面同意，不得複製、修改、再散布，或用於任何產品與作品。詳見 [LICENSE](LICENSE)。

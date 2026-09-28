# 架構與設計理由

[English](ARCHITECTURE.md) | **繁體中文**

這份文件說明 Solo AI Team 為什麼這樣設計。它把 Anthropic 公開描述的 Claude Code 開發做法，縮小成一個人加一個 Max 5x 方案用得起的規模。安裝和日常用法請看 [USAGE.zh-TW.md](USAGE.zh-TW.md)。

文中引用的 Anthropic 數字都出自文末的公開來源（2026-09 閱讀），多數是自我報告。其中 Code Review 的 84% / 31%、auto mode 的 93%、C compiler 的 16 個 agent，發佈前已經對照原文確認過。

## 0. 核心分工

**模型負責「做」，工具負責「判定做對了沒」，人負責「方向」和「驗收」。**

這樣分工，是因為三方的成本不同。模型產出程式碼很便宜，但它對自己成果的判斷不可靠。lint、型別檢查和測試的判斷可靠，而且不花 token。人的判斷最有價值，但注意力最少。所以架構讓模型大量產出，由工具自動把關，只把少量高價值的決定留給人。

## 1. 十條原則

每條原則分成三段：Anthropic 怎麼做、為什麼有效、這個套件怎麼做。

### 1.1 驗證是最大的槓桿

- **Anthropic**：Boris Cherny 說，讓 Claude 有辦法驗證自己的成果（跑測試、跑指令、開瀏覽器），品質可以提升 2 到 3 倍。Thariq Shihipar 整理內部數百個 skill 時指出，產品驗證類 skill 的效果最容易量測。Nicholas Carlini 讓 16 個平行的 Claude 寫 C compiler，得到的教訓是：驗證器必須近乎完美，否則 Claude 會解錯題目。
- **為什麼有效**：模型的每一步都是推測。沒有回饋時，錯誤會一路累積到最後才被發現；有自動回饋時，錯誤在下一步就被抓到，這時修正成本最低。回饋來自工具而不是模型自評，所以結果可信。
- **這裡的做法**：Claude 每結束一輪之前，Stop hook 會對它改過的檔案跑 lint、typecheck 和相關測試，失敗就擋下，只把錯誤行交給 Claude 修。`/check` 負責完整驗證，`/test-first` 讓另一個獨立的子代理先寫驗收測試。

### 1.2 先計畫，再一次做完

- **Anthropic**：Boris 大約 80% 的 session 從 plan mode 開始。計畫對了，Claude 通常可以一次做完。
- **為什麼有效**：方向錯誤是最貴的錯誤。在計畫階段修正只要改幾行字；實作完才修正，就得重寫、重測、重新 review。
- **這裡的做法**：`/spec` 先產生任務卡。M 以上的任務進 plan mode，`opusplan` 讓計畫階段使用 Opus。你核准計畫之後，Claude 才開始改程式。

### 1.3 小而持續更新的記憶

- **Anthropic**：Claude Code 團隊共用一份約 2,000 到 2,500 tokens 的 CLAUDE.md，每週更新好幾次。Boris review PR 時會 tag `@.claude`，把學到的規則寫回去。官方文件建議每個 CLAUDE.md 維持在 200 行以內。
- **為什麼有效**：CLAUDE.md 每個 session 都會載入，裡面每一行都持續花 token；檔案太長，重要規則也會被稀釋。有效的記憶要短，而且要從真實發生過的錯誤長出來，不是一開始就寫成一本法典。
- **這裡的做法**：你對這個專案的指令放在 `CLAUDE.local.md`（模板約 45 行，上限 150 行），框架規則放在 `.solo/rules/`、由它匯入，流程知識放進 skill，沒被呼叫就不佔 context。這些檔案都不進版控（見 §7.2）。

### 1.4 同樣的錯誤出現三次，就改成機械檢查

- **Anthropic**：Boris 在 Meta 時的習慣是：同一種 review 意見出現三到四次，就寫成 lint rule。Anthropic 後來也把 code review 本身自動化了。
- **為什麼有效**：文字規則靠模型每次都「記得遵守」，每次都可能失效；機械檢查每次都會執行，而且不花 token。但建立檢查也有成本，所以只值得為重複發生的問題建。
- **這裡的做法**：`ledger` 記錄每一類錯誤發生的次數。同一類第三次出現時，`/learn` 會提示 ESCALATE，並提出具體的 lint rule、測試或 check step。機械檢查上線後，對應的文字規則就刪掉。

這一條也修正了前身 harness 的方向：「用機制而不是模型自律來維持品質」是對的，但機制應該由錯誤次數觸發，而不是一開始就全部建好（見 §11）。

### 1.5 原型做很多，上線很少

- **Anthropic**：Claude Code 團隊可以在幾小時內連做約 20 個原型，再挑一個上線。終端機的 spinner 改了 50 到 100 版，約 80% 沒有上線。公司層級也把 Labs（孵化）和 Product（放大）分開。
- **為什麼有效**：寫程式變便宜之後，比較做出來的東西，比比較文件上的想法更快也更準。原型的用途是淘汰方向，所以要便宜，也要丟得掉。
- **這裡的做法**：`/proto` 讓 Sonnet 子代理平行做 2 到 3 個方向，每個子代理都有 turn 上限。選定之後，其他原型刪掉；選中的原型也只當參考，正式實作重新走 `/spec`。因為額度有限，數量是 2 到 3 個，不是 20 個。

### 1.6 角色跟著工作走

- **Anthropic**：所有人的正式職稱都是 Member of Technical Staff。根據第三方整理的訪談，Claude Code 團隊有五種角色（Prototyper、Builder、Sweeper、Grower、Maintainer），成員每週依需要輪換。Cat Wu 也描述過 PM 會寫原型、設計師會 ship code。
- **為什麼有效**：固定分工會產生交接成本和等待時間。一個人本來就身兼所有角色，真正的問題不是「誰來做」，而是「現在該切換到哪一種工作模式」。
- **這裡的做法**：每個角色是一個指令，不是常駐的 agent：Prototyper 對應 `/proto`，Builder 對應 `/spec` → 實作 → `/ship`，Sweeper 對應 `/sweep`，Maintainer 對應 `/bugfix`，Grower 對應 `/retro` 和 `/refresh`。大多數指令設成只有你能呼叫，不呼叫時連描述都不佔 context。

### 1.7 找出瓶頸，解決瓶頸

- **Anthropic**：官方文章寫到，程式碼產量上升之後，人工 code review 成為新的瓶頸（原文引用 Amdahl's law）。Boris 描述的順序是：寫程式的瓶頸解決後，瓶頸移到 review，接著是可維護性與安全。Code Review 的數據顯示，1,000 行以上的 PR 有 84% 被找到問題，50 行以下的 PR 只有 31%。
- **為什麼有效**：整體速度由最慢的那一段決定。一人團隊最慢的一段幾乎一定是你的注意力：看計畫、看 diff、判斷結果對不對。
- **這裡的做法**：你要看的東西被縮小到高價值的部分：任務卡（做什麼、為什麼）、計畫（怎麼做）、測試名稱（行為）、驗證結果和截圖（證據）。只有改動大或碰到高風險路徑時才跑 `/code-review`，因為小改動的 review 回報低。每週的 `/retro` 只挑一個瓶頸來改。

### 1.8 保持簡單，並隨著模型升級修剪

- **Anthropic**：Cat Wu 說明，團隊刻意讓實作保持簡單，方便模型變強時替換元件；每次新模型發布，團隊都會回頭檢查已上線的功能。
- **為什麼有效**：很多規則是在彌補「當時那個模型」的弱點。模型變強之後，這些補丁會變成雜訊，甚至讓新模型表現變差。
- **這裡的做法**：新模型或 Claude Code 大改版之後，`/refresh` 把所有規則分成四類：專案事實、慣例、補丁、已經機械化的規則。後兩類是刪除的候選。

### 1.9 刪除是正式工作

- **Anthropic**：Claude Code 團隊每隔幾週就拿掉一些功能，約 80% 的程式碼存在不到兩個月。Sweeper 是團隊裡的正式角色。
- **為什麼有效**：AI 讓新增程式碼幾乎免費，但每一行都要維護，也都可能被讀進 context。不刪的話，閱讀成本會逐漸吃掉速度。
- **這裡的做法**：`/sweep` 每週用 knip、編譯器警告和 grep 找出死碼與沒用的依賴，小步刪除，每一步都驗證。

### 1.10 安全靠機制，不靠自律

- **Anthropic**：使用者會核准大約 93% 的權限提示，形成核准疲勞。所以 Anthropic 做了 auto mode（由分類器審查每個動作）、sandbox 和容器化。內部約 3 萬個同時運作的 agent，每個動作在執行前都經過線上監控。
- **為什麼有效**：每件事都問，人就會習慣性按同意，等於沒問。正確的做法是只在真正危險的地方問，其餘交給規則和分類器。
- **這裡的做法**：Max 方案預設是 auto mode。套件再加上 deny 規則（讀 `.env`、force push）和 ask 規則（commit、push、刪資料表、雲端刪除），常用的安全指令放進 allow，同時省下分類器的呼叫。細節見 §8。

## 2. 一人版組織圖

```
                         你（Director）
           決定做什麼、為什麼 · 核准計畫與測試 · 看證據 · 最後出貨
                                 │
   ┌─────────────────┬───────────┴──────────┬───────────────────────┐
   規劃層              執行層                   偵察層                   機械層（0 token）
   Opus               Sonnet                  Haiku                   hooks + 腳本
   plan mode          主 session 實作          scout 子代理             Stop 驗證、格式化
   /spec  /refresh    test-author 子代理        讀檔、找位置、整理事實     token-guard、ledger
   /code-review       prototyper 子代理                                  statusline（額度）
   ─────────────────────────────────────────────────────────────────────────────
   記憶層：~/.claude/CLAUDE.md · CLAUDE.local.md · .solo/rules · skills（按需載入）
          · .solo/tasks（任務狀態）· .solo/ledger.json（錯誤次數）· .solo/decisions.md
```

「強模型在編譯期、弱模型在執行期」是前身 harness 的原則（見 §11），在這裡升格成模型分工的主軸：Opus 做少量但決定方向的工作（任務卡、計畫、規則修剪），Sonnet 做大量實作，Haiku 做便宜的偵察，最常執行的判定交給不花 token 的腳本。

| Anthropic 的做法 | 一人版的做法 |
|---|---|
| Labs 孵化、Product 放大 | `/proto`（丟棄式原型）和 `/spec` → `/ship`（正式實作） |
| 統一職稱，角色每週輪換 | 你身兼所有角色；角色是指令，不是常駐 agent |
| 共用 CLAUDE.md，每週更新 | `CLAUDE.local.md` 控制在 150 行內，由 `/learn` 提出更新 |
| 同一種意見重複三到四次就寫成 lint rule | ledger 第三次出現就提示 ESCALATE |
| Code Review（多 agent，每次約 15 到 25 美元） | 內建 `/code-review medium`，只在大改動或高風險路徑執行 |
| auto mode、分類器、容器化 | Max 預設 auto mode，加上 deny 和 ask 規則 |
| 3 萬個 agent 加上監控 | 同時最多 2 到 3 個 session，statusline 顯示額度 |
| R&D Automation Index 等內部指標 | `/retro` 的每週指標（不計算程式碼行數） |
| skill 先放 sandbox，有人用才進 marketplace | 新 skill 先在一個專案試用，證明有用再整理進 `~/.claude/skills` |
| 每次新模型發布就回頭檢查 | `/refresh` |

## 3. 一個任務的完整流程

| 步驟 | 執行者與模型 | 你要做的事 | 成本控制 |
|---|---|---|---|
| 1. `/spec`（在新 session 執行） | Opus | 回答產品問題（S/M 最多 3 題；L 或模糊的需求會逐題訪談），確認驗收條件 | context 很小，這時切換模型幾乎沒有代價 |
| 2. plan mode（M 以上） | Opus（`opusplan`） | 讀計畫，核准或修正 | 大範圍探索交給 scout（Haiku） |
| 3. `/test-first`（行為不單純時） | test-author（Sonnet，獨立 context） | 看測試名稱和斷言：這是槓桿最高的 review | 出題者和答題者分開 |
| 4. 實作 | Sonnet | 原則上不用盯 | 每次編輯後格式化（共用 repo 只保留改動附近的格式化）；Stop hook 自動驗證 |
| 5. `/check` | Sonnet 加 runner | 看每個步驟的結果行 | runner 只回傳錯誤行和 log 路徑 |
| 6. `/ship` | Sonnet，必要時加內建 `/code-review` | 看 `ship.md`（檔案清單、commit 計畫、PR 說明與證據）和高風險路徑的 diff；共用 repo 由你自己 commit | 由腳本決定要不要 review |
| 7. `/learn` | Sonnet | 核准記憶和規則的變更 | 每次最多 5 條 |

context 用量超過 50–60%，或你要離開超過一小時，先 `/handoff` 再 `/clear`。新 session 開始時，SessionStart hook 會自動載入任務卡和進度。

### 範例：訂單列表加上日期區間篩選（Angular + ASP.NET Core）

1. 在終端機執行 `claude -w order-filter`。Claude Code 會建立一個獨立的 worktree 和分支。
2. `/spec 訂單列表加上日期區間篩選`。Claude 只問一個產品問題：「區間留白時要顯示全部，還是最近 30 天？」你回答後，它寫出有四條驗收條件的任務卡。
3. 按 Shift+Tab 進 plan mode。Opus 提出計畫：API 加上 from、to 參數，EF Core 查詢，Angular 的日期元件和 signal 狀態。你核准後，計畫存成 `plan.md`。
4. `/test-first`。test-author 寫出 .NET 端點測試和 Angular 元件測試，目前全部失敗。你花三分鐘看測試名稱，確認它們描述的是你要的行為。
5. Sonnet 開始實作。每一輪結束前，Stop hook 對改過的 `.cs` 跑 `dotnet build`，對改過的 Angular 檔案跑 eslint 和 `ngc --noEmit`（連 template 一起做型別檢查），失敗就讓 Claude 自己修。
6. `/check`。`ng test`、`ng build`、`dotnet test` 全部通過；`snap.mjs` 截下桌面版和手機版的畫面。
7. `/ship`。review gate 算出改動 180 行、沒有碰到高風險路徑，所以跳過 review。這是團隊 repo，所以 Claude 不動 git，只把檔案清單、commit 計畫和附上驗證結果與截圖路徑的 PR 說明寫進 `.solo/tasks/order-filter/ship.md`，由你自己 commit、push、開 PR。在個人 repo 可以用 `/ship pr`，Claude 會在 commit 和 push 前各問你一次。
8. `/learn`。Claude 記下一條教訓：「EF 的日期比較要先統一成 UTC」，歸類為 `api-contract`，並提議在 `.solo/rules/dotnet.md` 加一行規則。

## 4. 記憶與知識的分層

原則：越常被載入的層越要短，越具體的知識放在越晚載入的層。

| 層 | 位置 | 何時載入 | 放什麼 | 不放什麼 |
|---|---|---|---|---|
| 個人層 | `~/.claude/CLAUDE.md` | 每個 session | 語言、溝通風格、通用原則 | 任何專案細節 |
| 團隊的專案層 | repo 裡的 `CLAUDE.md`（如果團隊有） | 每個 session | 團隊的規範 | 套件不會修改它 |
| 你的專案層 | `CLAUDE.local.md` | 每個 session | 指令、目錄地圖、流程、Gotchas | linter 能檢查的規則 |
| 框架規則 | `.solo/rules/*.md`（由 `CLAUDE.local.md` 匯入） | 每個 session | 框架和語言的規則 | 全專案通用的規則 |
| 流程 | `~/.claude/skills/*/SKILL.md` | 被呼叫時；只限使用者呼叫的 skill 連描述都不載入 | 做事的步驟 | 專案事實 |
| 任務狀態 | `.solo/tasks/<slug>/` | SessionStart 自動注入任務卡和進度 | spec、plan、progress、證據 | 長期知識 |
| 錯誤次數 | `.solo/ledger.json` | 用 CLI 查詢 | 每類錯誤的次數與最近一條教訓 | 規則本身 |
| 架構決策 | `.solo/decisions.md` | `/spec` 規劃前讀取 | 決定、理由、放棄的選項 | 實作細節 |
| 自動記憶 | `~/.claude/projects/<project>/memory/` | 每個 session 載入 MEMORY.md 前 200 行 | Claude 自己記的便條 | 需要審核的規則 |

自動記憶是 Claude Code 內建的功能。它和 `/learn` 的分工是：自動記憶是 Claude 隨手記的便條，`/learn` 產生的是經過你核准的正式規則。`/refresh` 會提醒你用 `/memory` 檢查自動記憶的大小。

套件常駐在 context 的內容（`CLAUDE.local.md` 模板、匯入的框架規則、兩個可自動觸發的 skill 描述、三個子代理描述）合計約 1,300 tokens 以內。作為對照，Claude Code 團隊自己的 CLAUDE.md 約 2,500 tokens。

## 5. 驗證與品質

### 5.1 分層檢查

| 層級 | 觸發時機 | 內容 | 時間 | 對 token 的影響 |
|---|---|---|---|---|
| PostToolUse hook | 每次編輯檔案 | 格式化該檔案；選用的 token-guard | 通常 1 到 2 秒 | 沒有違規就是 0 |
| Stop hook | 每一輪結束，而且這一輪有編輯 | 對改過的檔案跑 lint、typecheck、相關測試；test guard 比對測試有沒有變弱 | 數秒到數十秒 | 失敗才回傳錯誤行 |
| `/check` | 宣稱完成之前 | 完整 lint、測試、build，UI 截圖 | 分鐘級 | 只回傳摘要 |
| `/ship` | 出貨之前 | 完整檢查、test guard，加上條件式 `/code-review` 和 `/security-review`；改動太大時建議拆 PR | 分鐘級 | review 只在需要時跑 |
| `/sweep` | 每週 | 死碼、依賴、TODO | 視專案而定 | 候選清單最多 20 項 |

### 5.2 讓檢查可信又省 token 的七個機制

1. **摘要輸出。** check runner 只把錯誤行（附一行上下文）和 log 路徑交給 Claude，其餘輸出寫進 `.solo/logs/`。Claude 需要更多資訊時再自己讀 log。
2. **重試上限。** Stop hook 最多連續擋三輪。第三輪之後還是失敗，就讓 Claude 停下，並暫停檢查到下一次編輯，避免修不好的錯誤一直燒額度。
3. **baseline。** 舊專案通常本來就有很多 lint 和型別錯誤。`--update-baseline` 之後，Stop hook 只擋新出現的錯誤。baseline 以錯誤訊息的文字為 key、不含行號，所以程式碼上下移動時，舊錯誤不會被誤判成新錯誤。
4. **子代理的編輯不追蹤。** test-author 寫的測試本來就應該是紅燈，prototyper 的原型本來就是丟棄式的，所以 Stop hook 不會要求主 session 去修它們。
5. **token-guard 只看改動的行。** 它用 `git diff HEAD` 找出和 HEAD 不同的行，只回報這些行上的違規。舊檔案原有的寫死色碼不算在這次編輯頭上，Claude 也就不會順手去改一堆和任務無關的地方。要稽核整個專案時，手動執行 `node .solo/engine/token-guard.mjs <files>`。
6. **分辨「環境壞掉」和「程式碼有錯」。** `node_modules` 沒裝好或只裝一半時，每個檢查都會出現 `Cannot find module '...node_modules...'`。這不是改程式碼能修好的；如果照常擋下 Claude，它可能去改程式碼，或執行 `npm install` 改寫團隊的 lockfile。所以 runner 把這類失敗標成 `ENV`，並附上正確的還原指令（`npm ci`、`pnpm install --frozen-lockfile`、`dotnet restore`）；只有環境錯誤時，Stop hook 不擋 Claude，改成直接告訴你該執行哪個指令；`--update-baseline` 也不會把環境錯誤記成已知問題。安裝時就會檢查直接依賴的入口檔是否存在，提早發現問題；新增或移除依賴的指令都列在 ask 規則裡。
7. **檢查本身不能改檔案。** 團隊的 lint script 常帶著 `--fix`（實際在一個團隊 repo 遇過），照原樣執行就會改寫團隊的檔案。所以安裝程式遇到會改檔案的 script（`--fix`、`--write`、`-u`）時不照原樣執行：單一的 eslint 或 ng lint 呼叫會拿掉 `--fix` 再執行，其他情況改用單純的 `eslint .`。runner 另外在每個步驟前後比對被追蹤檔案相對 HEAD 的 diff，步驟執行後有檔案不一樣，那一步就算失敗並列出被改的檔案（`CHANGED FILES`），Stop hook 也會把它交給你，而不是擋下 Claude。同一類的防護還有：測試執行器連測試都載入不了（例如 Karma 的 `Found 1 load error`）時，代表一個測試都沒跑，這種結果不能記進 baseline，否則這一步會在零個測試的情況下變綠燈；報告會標成 `SUITE DID NOT RUN`，可以先用 `disabledSteps` 暫時停用。

### 5.3 規則升級的階梯

| 階梯 | 形式 | 每次的成本 | 可靠度 |
|---|---|---|---|
| 1 | 對話中說一次 | 只在當下 | 只在當下有效 |
| 2 | `CLAUDE.local.md` 的一行 | 每個 session 都花 token | 靠模型記得 |
| 3 | `.solo/rules` 或 skill 的 Gotchas | rules 每個 session 都花 token；skill 只在呼叫時 | 靠模型記得 |
| 4 | lint rule、測試、check step、hook | 0 token | 每次都執行 |

規則從低的階梯開始，只有在 ledger 顯示它重複發生時才往上升。升到第四階之後，第二、三階的文字就刪掉。

## 6. 算力預算（Max 5x）

### 6.1 事實（依 2026-09 的官方文件）

- 官方成本文件寫明，Sonnet 能處理大部分 coding 工作，成本比 Opus 低；Opus 留給複雜的架構決策和多步驟推理。Max 方案的預設模型是 Opus 5.5。套件把專案的預設模型設成 `opusplan`：plan mode 用 Opus，其餘時間自動切換成 Sonnet。
- 訂閱方案的用量以 5 小時和每週兩個視窗計算。statusline 直接顯示 context 用量、兩個視窗的用量百分比，以及 5 小時視窗的重置時間。
- 訂閱方案的 prompt cache 壽命約一小時。超過一小時沒有互動，第一則訊息就要重新處理整段 context。`/compact` 本身是一次大型請求，`/clear` 不消耗額度。
- 切換模型會讓 prompt cache 失效（advisor 例外）。所以換成較便宜的模型只適合在全新的 context 裡做，例如子代理或新 session。長對話中途把主模型換成 Haiku，它得重新讀整段沒有快取的 context，可能比繼續用已快取的 Sonnet 還貴。
- Fable 在部分方案會計入 usage credits（額外付費）。ultracode、`/batch` 和 agent teams 都會大量消耗 token；官方文件寫到，teammates 在 plan mode 運作時，agent teams 的用量約為一般 session 的 7 倍。

### 6.2 每日紀律

1. **模型分工**：預設 `opusplan`，scout 固定用 Haiku，`/spec` 和 `/refresh` 在新 session 裡用 Opus。同一個問題卡住兩次，才開 `/advisor opus`（Sonnet 繼續做，Opus 只在決策點給建議）或 `/model opus`。
2. **Context**：用量到 50% 到 60% 時，先 `/handoff` 再 `/clear`。離開超過一小時，回來先 `/clear`。和任務無關的小問題用 `/btw` 問，不讓它進入對話歷史。
3. **並行**：同時最多 2 個實作 session，各自在自己的 worktree；另外可以有 1 個輕量 session 做 spec 或 review。
4. **視窗節奏**：需要 Opus 的規劃放在 5 小時視窗的前段。5 小時視窗超過 80% 時，改做 review、手寫程式或學習模式。每週視窗在週中就超過 70% 時，改成單線作業，也不做 `/proto`。
5. **預設避免**：ultracode、`/batch`、agent teams、Fable、每次 push 都 review、預設開啟 advisor。
6. **量測**：用 `/usage` 的 attribution 看哪個 skill 或子代理最花額度。每月跑一次 `/insights` 看跨 session 的摩擦點，但它本身也會消耗額度。

## 7. 並行、worktree 與私有安裝

### 7.1 worktree

`claude -w <name>` 會在 `.claude/worktrees/<name>/` 建立 worktree，分支名稱是 `worktree-<name>`。worktree 是全新的 checkout，看不到沒有 commit 的檔案，所以安裝程式會建立 `.worktreeinclude`，列出套件的私有檔案（engine、config、rules、ledger、`CLAUDE.local.md`、`.claude/settings.local.json`），Claude Code 建立 worktree 時會把它們複製過去。`.worktreeinclude` 本身也被排除在 git 之外。團隊已經有自己的 `.worktreeinclude` 時，安裝程式不會動它，這時請在主要的 checkout 裡工作。

hook 的指令是一小段啟動程式：從 `CLAUDE_PROJECT_DIR`（session 開始的資料夾）往上找 `.solo/engine/`，找到就執行對應的 hook，找不到就什麼都不做。所以 VS Code 開在子資料夾（例如 `frontend/`）時 hooks 也能運作；依官方文件，Claude Code 在子資料夾啟動時，仍然會讀 repo 根目錄的 `.claude/settings.local.json`，SessionStart 則會提醒 Claude 從根目錄執行套件的指令。hook 讀的是 hook 輸入裡的 `cwd`，所以在 worktree 裡檢查的是 worktree 的檔案。

每個 worktree 都要各自安裝依賴（例如 `node_modules`），會花時間和硬碟空間；pnpm 共用套件儲存區，可以降低這個成本。適合並行的是彼此獨立的任務，例如一個功能加一個 bug 修正；把同一個功能拆給多個 session，協調成本通常比省下的時間還多。Boris 同時開 5 個本機 session 加上 5 到 10 個網頁 session，但 Max 5x 的合理上限是 2 個實作 session 加 1 個輕量 session。

### 7.2 私有安裝：套件不進版控

目的是讓你能在整個團隊都在 pull 的 repo 裡使用套件，而且沒有任何人看得到。做法分成三部分。

1. **檔案位置。** skills 和子代理放在 `~/.claude/`，完全不在 repo 裡。repo 裡只有 `.solo/`（engine、設定、規則、ledger、決策紀錄、任務狀態）、`CLAUDE.local.md`、`.claude/settings.local.json` 和 `.worktreeinclude`，用過 `/proto` 的話還會多一個原型資料夾。其中 `CLAUDE.local.md` 和 `settings.local.json` 本來就是 Claude Code 官方定義的個人檔案，團隊依慣例不會 commit。如果某個 repo 偏偏追蹤了 `.solo/`、`CLAUDE.local.md` 或 `.claude/settings.local.json`，安裝程式會在寫入任何東西之前停下來。
2. **隱藏方式。** 這些路徑寫進 `.git/info/exclude`。它和 `.gitignore` 的作用一樣，差別在於它只存在你這份 clone 裡，本身不會被 commit 或 push。所以 `git status` 看不到這些檔案，`git add -A` 也不會把它們加進去。安裝程式不修改任何被追蹤的檔案（包括 `.gitignore`），並在安裝前後各跑一次 `git status`、印出比對結果。
3. **不干擾團隊。** 團隊之後如果 commit 了自己的 `CLAUDE.md`、`.claude/settings.json` 或 `.claude/skills/`，你照常 pull 不會衝突，兩邊的指令和 hooks 同時生效。repo 沒有 Prettier 設定檔時，安裝程式預設關閉「編輯後自動格式化」，避免改一行卻讓整個檔案被重排，讓隊友的 PR diff 出現大量格式變動。

代價是私有檔案沒有版本紀錄。`/learn` 改規則前仍然會先給你看 diff，但改完之後 git 裡查不到歷史。想保留歷史的話，可以在 `.solo/` 裡另外 `git init` 一個只屬於你的 repo；它位在被排除的資料夾裡，不影響團隊的 repo。

### 7.3 共用 repo 模式

私有安裝保證套件的檔案不進版控，但套件的行為還是可能碰到團隊看得到的東西：`/ship` 會 commit 和 push、`/sweep` 會 commit、格式化工具可能重排整個檔案、token-guard 會建議在程式碼裡加註解。所以安裝程式會看最近 200 個 commit：只要有不是你（依 `git config user.email` 判斷）的作者，就在 `.solo/config.json` 寫入 `"shared": true`，只有一位同事在寫的專案也算。新電腦還沒設定 `user.email` 時，所有作者都算別人，結果偏向保守。也可以用 `--shared`、`--personal` 直接指定。共用 repo 裡：

- `/ship` 預設 `manual`：檢查和 review 照跑，但只把檔案清單、commit 計畫和 PR 說明寫進 `.solo/tasks/<slug>/ship.md`，不執行任何會寫入的 git 指令。`/ship commit`、`/ship pr`、`/ship direct` 是明確的要求，而且 commit、push 仍然會先問你。
- `/sweep` 不 commit、不切分支，把每組刪除和建議的 commit 訊息記在 `.solo/`。
- PostToolUse hook 在格式化前後各算一次「這個檔案相對 HEAD 改到哪幾行」（兩次都以 HEAD 的行號計算，所以可以直接比較）。格式化如果改到距離這次改動超過 3 行、原本沒人動過的行，就把檔案還原成格式化前的內容。格式本來就一致的檔案照常格式化；格式不一致的舊檔案，不會因為改一行就變成整個檔案的 diff。這兩種情況都用真的 Prettier 3 驗證過。
- token-guard 不要求加 `token-guard-ignore` 註解；刻意保留的值在同一個 session 只回報一次。
- `/learn` 升級出來的機械檢查只寫進 `.solo/`；團隊的 lint 設定、CI、測試只會變成給你的建議。
- `/proto` 的原型資料夾被排除在 git 之外，接到路由的那幾行在選定方向後還原。
- `CLAUDE.local.md` 多一條規則：照團隊既有的慣例寫，不在程式碼裡加套件專用的註解。「沒有你明確要求就不 commit、不 push」則是每個 repo 都有。

這些行為都寫進了 `selftest.mjs`：它建立一個模擬的遠端 repo 和兩份 clone，確認安裝後 `git status` 是空的、`.gitignore` 沒變、`git add -A` 不會加入任何套件檔案、原型資料夾看不到，隊友 commit 自己的 Claude 設定之後你的 pull 依然成功；也測試有別人的 commit 會自動進入共用模式（包括只有一位同事在寫的專案）、只有自己的 commit 是個人模式、`--shared --reconfigure` 可以切換、repo 追蹤了個人路徑時安裝程式什麼都不寫，以及共用模式下的格式化還原和 token-guard 行為。selftest 的 git 使用自己的空設定，所以這些結果不會被你電腦上的全域 git 設定影響。

### 7.4 被排除的檔案可能被 pull 覆蓋

git 把被 ignore 的檔案視為可以覆蓋。萬一隊友 commit 了同名的 `CLAUDE.local.md` 或 `.claude/settings.local.json`，你 `git pull` 時 git 會直接用團隊的版本蓋掉你的私人版本，不會提示（在 git 2.43 實測過）。所以 SessionStart hook 每次都把這兩個檔案備份到 `.solo/backup/`；一旦它們變成被追蹤的檔案，就提醒 Claude 在第一句話告訴你。`/learn`、`/refresh` 也會先檢查，不去修改已經被團隊追蹤的 `CLAUDE.local.md`。

## 8. 安全與權限

Max 方案預設是 auto mode，由分類器審查每個動作。套件的 settings 在這之上加了三層規則，寫在 `.claude/settings.local.json`，只對你生效。

- **deny**：禁止讀取 `.env`、`.env.local`、`.env.*.local`、`.env.production`、`*.pem`、`*.pfx`、`*.p12`、`secrets/` 目錄，也禁止 `git push --force` 和 `git push -f` 的各種寫法。`--force-with-lease` 不在禁止範圍內，但所有 push 都會先問你。
- **ask**：commit、push、`git reset --hard`、`git clean`、`git rebase`、刪除分支、合併 PR、發佈套件、`dotnet ef database`、`DROP TABLE`、`DROP DATABASE`、`TRUNCATE TABLE`、AWS 的刪除與終止指令，以及新增或移除依賴（`npm install`、`pnpm add`、`dotnet add` 等）都會先問你。官方文件說明 ask 規則在 auto mode 下仍然有效。
- **allow**：套件自己的腳本，以及 `git add`、`git switch`、`git worktree list`。依官方文件，auto mode 會先比對 allow、ask、deny 規則，符合的直接決定、不送分類器，所以也省下分類器的呼叫。auto mode 會自動停用範圍過寬的 allow 規則（例如 `Bash(*)`）；被停用的規則改由分類器審查，功能不受影響。

`.claude/` 是 Claude Code 的受保護路徑，Claude 修改 `.claude/settings.local.json` 時會交給分類器判斷或問你。`.solo/` 裡的規則和設定不是受保護路徑，所以 `/learn` 和 `/refresh` 都規定先給你看 diff、等你核准才寫入，取代前身 harness 的正式修憲流程。

套件自己的 git 指令全部是唯讀的，而且都設定 `GIT_OPTIONAL_LOCKS=0`：`git status` 不去更新索引，statusline 每次刷新時，都不會和你（或 VS Code）正在執行的 git 搶 `.git/index.lock`。VS Code 的背景 git 也是用同樣的設定。

需要知道的限制：官方文件明確說明，Bash 規則比對的是指令文字，不是安全邊界，同一個程式換一種寫法呼叫就可能繞過。auto mode 的分類器是第二道防線。用了一週之後，可以執行內建的 `/fewer-permission-prompts`，從紀錄中整理出安全的 allowlist。

## 9. 學習與維護迴圈

| 頻率 | 動作 | 目的 |
|---|---|---|
| 每個任務結束 | `/learn` | 記錄教訓，決定放在哪一層，必要時升級成機械檢查 |
| 每週一 | `/retro` | 從 git 紀錄和 ledger 找出一個瓶頸，選一個實驗 |
| 每週五 | `/sweep` | 刪除死碼和沒用的依賴 |
| 新模型或大改版 | `/refresh` | 刪掉已經不需要的補丁規則 |
| 新寫的 skill 在一個專案證明有用 | 整理進 `~/.claude/skills` | 讓所有專案都能用 |

`/retro` 的指標是已出貨的任務數、修正或回退的 commit 數（重工的訊號），以及 ledger 裡最常出現的錯誤類別。指標刻意不包含程式碼行數：Anthropic 自己也說明，每位工程師 8 倍的合併量是以行數計算，「幾乎肯定誇大了」實際的生產力提升。

## 10. 人的能力

Anthropic 2025 年 12 月的內部調查記錄了幾個代價：員工擔心產出太容易之後，反而更難真正學會東西；原本會問同事的問題約有 80% 到 90% 改問 Claude，資深工程師發現 junior 來問的次數變少；超過一半的員工表示，能完全交給 Claude 的工作只有 0% 到 20%。

一人版的對策有四個：

1. **學習模式。** 個人層 CLAUDE.md 模板定義了觸發詞：你說「教我」或「learning mode」時，Claude 不直接寫答案，而是用提問引導你寫，再 review 你的程式碼。
2. **保留手寫。** 如果你還要通過技術面試，或想維持手寫能力，每週至少挑一個任務的核心邏輯自己寫，例如狀態管理、非同步流程或資料結構。
3. **先看懂再核准。** 計畫和測試都要看懂才核准；看不懂的地方請 Claude 解釋機制，不要直接接受。
4. **保留最終責任。** Boris 解釋 Anthropic 仍然招募工程師的原因：總要有人 prompt 這些 Claude、跟客戶談、跟其他團隊協調、決定下一步做什麼。在一人團隊裡，這些都是你的工作。

## 11. 演化來源：agent-harnesses

Solo AI Team 是 [agent-harnesses](https://github.com/yapeepee/agent-harnesses) 裡 [`claude-quality-harness-v3`](https://github.com/yapeepee/agent-harnesses/tree/main/claude-quality-harness-v3) 的後繼。v3 用 4 個 review agent（arch-guardian、decision-keeper、token-auditor、slop-critic）、3 個 hook、憲法層（SPIRIT / TASTE / SUNSET）、12 個 golden fixture 和 verdict ledger，維持長時間自主 session 的品質。這個套件保留 v3 的核心原則，但改變了「機制從哪裡來」：機制在 ledger 顯示錯誤重複發生時才建，而不是一開始就全部常駐。

| v3 的元件 | 處理方式 | 在這裡的位置 | 理由 |
|---|---|---|---|
| 「強模型在編譯期、弱模型在執行期」 | 保留並升格 | 模型分工：`opusplan`、scout（Haiku）、零 token 的腳本 | 和 Anthropic 的 opusplan 與 advisor 是同一個方向 |
| token enforcement（token-lint hook，含 Angular 樣式繞道偵測） | 重塑 | `token-guard.mjs`，選用 | 改成零依賴的 Node 腳本；支援 Tailwind v4 arbitrary value；custom property 視為 token 定義；HTML 裡的 `<style>` 當 CSS 檢查；編輯時只看改動的行；`assets/` 預設排除；ignore 註解不怕 Prettier 搬動 |
| verdict ledger | 重塑 | `.solo/ledger.json` 加上 ESCALATE | 用途從「記錄判決」改成「決定什麼時候機械化」 |
| golden fixtures | 保留為升級選項 | `/learn` 的機械檢查選項之一 | 輸出穩定的功能，用 golden 或 snapshot 測試最省事 |
| decision-keeper agent | 重塑 | `.solo/decisions.md`，由 `/spec` 讀取 | 決策紀錄不需要常駐 agent |
| arch-guardian agent | 重塑 | 由 ledger 觸發的機械檢查（例如 dependency-cruiser、eslint-plugin-boundaries、NetArchTest） | agent 判斷每次都花 token，結果也不穩定 |
| slop-critic agent | 重塑 | 內建 `/code-review`（medium 以上包含清理建議），加上 ledger 的 `slop` 類別 | 內建功能會隨 Claude Code 升級變強 |
| token-auditor agent | 併入 | `token-guard.mjs` | 同一件事用腳本做更可靠 |
| SPIRIT.md、TASTE.md | 濃縮 | 個人層 CLAUDE.md 的 8 行原則；設計品味放進 UI 專案的 rules 或設計類 skill | 長篇憲章每個 session 都載入，而模型對具體檢查的遵守度高於抽象價值 |
| 正式修憲流程（precedents、amendments） | 捨棄 | `/learn` 先給 diff，你核准後才寫入 | 流程成本高於收益；私有檔案要歷史時，可以在 `.solo/` 另開個人 repo |
| Python analyzer tools | 改寫 | Node 腳本 | 與主力語言一致，Windows 上也不用另外處理 Python 環境 |

既有的 skill 可以並存。設計參考類的 skill 可以在 `/proto` 提供 UI 方向；會改寫 CLAUDE.md 的 skill 和 `/learn`、`/refresh` 功能重疊，建議只留一套，避免兩個來源同時改寫記憶。

## 12. 套用到各種專案

| 專案類型 | 安裝程式偵測到的設定 | 你要補的事 |
|---|---|---|
| Angular 17 以上（實測 22） | stop：eslint（有裝才跑）、`ngc -p tsconfig.app.json --noEmit`（TypeScript 加 template 型別檢查）；full：lint、`ng test`（`angular.json` 有 test target 才跑）、`ng build`；`rules/angular.md` | 沒有 ESLint 或測試框架時安裝程式會提醒；UI 專案可開 token-guard；裝 Playwright 後可用 snap 截圖 |
| Angular 17 以下 | legacy 規則檔；Karma 加上 ChromeHeadless | 先執行 `--update-baseline` |
| React（Vite） | stop 階段用 `vitest related` 只跑相關測試 | 依專案補 `ui.routes` |
| ASP.NET Core | stop：改到 `.cs` 才跑 `dotnet build`；full：`dotnet test` | 有 CSharpier 的話可以加進 `format` |
| Python | 偵測到 ruff 和 pytest 才加入 | 依專案調整 |
| 沒有測試的舊系統（例如 Classic ASP） | 產生空的 stack，hook 只追蹤編輯 | 在 `full` 加上 smoke 指令；先補 characterization test；spec、handoff、learn 照常使用 |
| 一個 repo 裡有多個前後端 | 每個資料夾各自成為一個 stack；每個檔案只歸屬最內層的 stack | 確認 `.solo/config.json` 的 `root` |

## 13. 已知限制與取捨

- **Stop hook 會讓每一輪多等幾秒到幾十秒。** 換到的是少一輪「人工發現錯誤、再請 Claude 修正」的來回。
- **Angular 的測試只在 full 階段跑。** `ng test` 沒有「只跑相關測試」的模式，所以 Stop 階段只跑 lint 和 typecheck。typecheck 用 `ngc` 而不是 `tsc`，因為只有 `ngc` 會檢查 template；代價是比較慢（見 §15）。嫌慢的話，可以在 `.solo/config.json` 換回 `tsc --noEmit -p tsconfig.app.json`，但 template 錯誤就要等到 `ng build` 才會被發現。
- **baseline 比對是啟發式的。** 它以錯誤訊息的文字為 key，所以同一個檔案裡訊息完全相同的新錯誤，會被當成舊錯誤。
- **Bash 權限規則是文字比對，不是安全邊界**（見 §8）。
- **換行必須是 LF。** 安裝程式用以 `\n` 錨定的 regex 解析模板。git clone 由 `.gitattributes` 保證 LF；用其他方式複製、被轉成 CRLF 的檔案，會讓規則模板的 front matter 剝不乾淨。
- **驗證範圍。** selftest 67 項：建置時在 Linux 通過，2026-09-28 在 Windows 11 原生通過，之後每次 push 由 CI 在 Ubuntu 與 Windows × Node 18/22 執行。另外在一個真實的 TypeScript 專案（eslint、tsc、vitest、Prettier）和一個 Angular 22 專案（§15）跑過完整流程。macOS 沒跑過。
- **能省多少額度，目前沒有量化數據。** 請用 `/usage` 的 attribution 和 statusline 自己量。
- **Claude Code 變化很快。** 套件用到的功能多在 v2.1.2xx 之後才有，安裝前先 `claude update`。
- **Anthropic 公布的數字**（80% 的合併程式碼、每人 8 倍的合併量、200% 的產出成長）多數是自我報告，而且以行數計算。這個架構不追求這些數字，也不用程式碼行數當指標。

## 14. 四週導入順序

1. **第一週，只用核心**：安裝套件，只開一個 session，使用 `/spec`、plan mode、Stop hook、`/check`、`/handoff` 和 `/learn`，觀察 statusline 上的額度變化。
2. **第二週，加入出貨流程**：開始用 `/ship` 和 review gate，用 worktree 同時跑兩個任務，執行一次 `/fewer-permission-prompts`。
3. **第三週，加入進階工具**：開始用 `/test-first`、`/proto` 和 `/bugfix`；UI 專案開啟 token-guard，並設定 snap 截圖。
4. **第四週，開始維護迴圈**：第一次 `/retro`、`/sweep` 和 `/refresh`，刪掉沒用到的東西，把已經證明有用的 skill 搬到個人層。

## 15. 實測：一個真實的 Angular 22 專案

實測環境是一台 Linux VM，專案是一個團隊 repo 的本機 clone：Angular 22，前端放在 repo 的子資料夾，`node_modules` 直接連結到原本的資料夾。過程沒有修改那個 repo，也沒有任何 commit 或 push。

| 項目 | 結果 |
|---|---|
| 專案偵測 | 正確偵測為 Angular 22 的 stack，root 是前端的子資料夾；stop 階段是 `ngc --noEmit`，full 階段是 `ng build`；套用 `rules/angular.md` |
| 工具提醒 | 安裝程式指出這個專案沒有 ESLint、沒有測試框架、沒有 Prettier |
| 乾淨狀態的 Stop 檢查 | PASS，約 41 秒 |
| 故意在 `app.component.html` 呼叫不存在的 `title()` | Stop hook 擋下；交給 Claude 的訊息約 700 字元：`error TS2339: Property 'title' does not exist on type 'AppComponent'`，並附上 template 行號和來源元件 |
| 修正之後 | Stop hook 顯示 PASS；下一輪沒有編輯時完全不執行 |
| 對照：只用 `tsc --noEmit` | 約 23 秒，但抓不到上面那個 template 錯誤 |
| token-guard 全專案稽核（218 個檔案） | 修正誤判前 132 筆；修正 `<style>` 與 `assets/` 的誤判後 102 筆；其中 61 筆是 page builder renderer 的 `[style.*]` 綁定，在 page builder 裡是正當用法；關掉 `styleBinding` 後剩 37 筆，集中在全域樣式、匯入工具和圖庫三處 |
| 在已有 9 筆舊違規的 `styles.css` 新增一行寫死色碼 | 只回報新的那一行 |
| review gate、SessionStart、statusline | 都正常運作 |

這次實測也改進了套件本身：Angular 改用 `ngc` 做 template-aware 的 typecheck；沒有 test target 時不再加 `ng test`；token-guard 修掉兩類誤判，並且只看改動的行；git 讀取全部加上 `GIT_OPTIONAL_LOCKS=0`，因為實測時 VM 裡的 `git status` 曾在那個 repo 的 `.git` 留下一個無法刪除的 `index.lock`（已清除）。

時間的解讀：41 秒和 23 秒是在 VM 裡透過掛載的磁碟讀 `node_modules` 量到的，Windows 原生環境通常比較快。請以你自己跑 `node .solo/engine/check.mjs --stage stop --changed` 的結果為準。

給這類專案的建議：

1. 開啟 token-guard，但 page builder 這類專案把 `styleBinding` 關掉：`"tokenGuard": { "enabled": true, "rules": { "styleBinding": false } }`。因為只檢查改動的行，舊違規不會干擾日常工作。
2. 補上 ESLint（`ng add angular-eslint`），再用 `--reconfigure` 重跑安裝程式，Stop 階段就會加上 lint。
3. 補上測試框架。沒有測試時，檢查只能證明「編譯得過」，`/test-first` 也無法使用。

## 16. 比對其他 workflow 之後加入的五項

2026 年 9 月，套件比對了 Anthropic 官方的最佳實踐和十幾位實務者公開的做法（Mitchell Hashimoto、OpenAI、HumanLayer、Harper Reed、Kent Beck、Simon Willison、Armin Ronacher、Peter Steinberger、Addy Osmani、Superpowers、Beads、Ralph），也參考 METR、DORA 的研究，以及 Birgitta Böckeler 對 spec-driven development 的評估。多數做法套件原本就有，下面五項是新加的。

1. **test guard**（`kit/engine/test-guard.mjs`）。Kent Beck 列出三個該叫停 agent 的訊號，其中一個是作弊：停用或刪掉測試讓它通過。原本套件只在 Stop hook 的訊息裡用文字要求不要這樣做，現在改成機械比對：把改過的測試檔和 HEAD 比較，測試數量變少（包括被註解掉）、新增 skip / only / focus 標記、斷言變少，或整個測試檔被刪除，都算「變弱」。支援 Jasmine、Jest、Vitest、xUnit、NUnit、MSTest 和 pytest 的寫法；用 `mv` 搬移的檔案不算刪除。Stop hook 對同一組發現只擋一次，要求 Claude 復原或用一句話說明理由；之後放行，但 PASS 訊息會一直列出這些檔案，讓你在 commit 前看到。`/ship` 用 `--base auto` 對整個分支再跑一次，結果寫進 `ship.md`。這是純文字比對，不花 token，也不需要跑測試。
2. **code intelligence plugins**。官方 marketplace 的 `typescript-lsp` 和 `csharp-lsp` 讓 Claude 每次編輯後就看到 language server 的型別錯誤，不必等 Stop hook。它們裝在個人層，所以安裝程式只檢查是否已安裝，缺的列在 Notes。TypeScript 的 language server 不檢查 Angular 範本，所以 Stop hook 的 `ngc` 仍然保留；Angular 規則檔另外提醒 Claude 在 VS Code 用 `getDiagnostics` 讀 Problems 面板。
3. **`/spec` 的訪談模式和自足的 spec**。依 Anthropic 的建議，L 任務或模糊的需求改用 AskUserQuestion 逐題訪談。spec 範本新增「涉及的檔案與介面」、「預估改動檔案數」和「端到端驗證」，目標是讓一個沒看過對話的新 session 也能照著實作。M 任務寫完 spec 後先 `/clear` 再進 plan mode，計畫寫成幾個階段，每個階段列出會改的檔案和驗證指令。這是 HumanLayer 的做法：review 槓桿最高的地方是計畫，不是程式碼。
4. **`.solo/inbox.md`**。Steve Yegge 的 Beads 規則是：超過約兩分鐘的工作就記下來，不要當場做。套件原本只要求「記下來、不要順手修」，沒規定記在哪裡；現在 Claude 把順手發現的問題寫進這個私人檔案，`/spec`（不帶參數時）、`/sweep`、`/retro` 和 `/handoff` 都會讀它。完整的 Beads 會在 repo 裡建立資料夾，對一個人的規模來說太重。
5. **結構與行為分開，改動太大就拆**。Kent Beck 的 Tidy First 規則是結構改動（重新命名、搬移、抽出）和行為改動分開提交，而且結構先做；DORA 2025 把「小批次」和「良好的版本控制習慣」列為讓 AI 發揮效果的七項能力之二。所以 `ship.md` 的 commit 計畫分成結構和行為兩組；改動達到 `review.splitLines`（預設 400 行）時，review gate 會印出 `SPLIT SUGGESTED`，`/ship` 先提出拆分方式再繼續。

刻意不採用的有五項，理由都是成本或風險：Ralph loop（Huntley 自己說不會用在既有 codebase）；Superpowers 為每個小任務各開一個 subagent 再逐一 review 的模式（Max 5x 撐不住）；spec-kit 和 Kiro 這類完整的 spec-driven 工具（Böckeler 用 Kiro 修一個小 bug 就得到 16 條驗收條件）；同時開 3 到 8 個 agent（瓶頸會變成 review）；讓 agent 自己 commit（和共用 repo 的規則衝突）。

## 參考來源

- [How AI Is Transforming Work at Anthropic](https://www.anthropic.com/research/how-ai-is-transforming-work-at-anthropic)
- [When AI builds itself（Anthropic Institute）](https://www.anthropic.com/institute/recursive-self-improvement)
- [Measurements for understanding the pace of AI development inside frontier labs](https://www.anthropic.com/institute/measuring-pace-of-ai-development)
- [Code Review for Claude Code](https://claude.com/blog/code-review)
- [Lessons from building Claude Code: How we use skills](https://claude.dev/blog/lessons-from-building-claude-code-how-we-use-skills/)
- [Product management on the AI exponential（Cat Wu）](https://claude.com/blog/product-management-on-the-ai-exponential)
- [Building a C compiler with a team of parallel Claudes](https://www.anthropic.com/engineering/building-c-compiler)
- [How we contain Claude across products](https://www.anthropic.com/engineering/how-we-contain-claude)
- [How we built Claude Code auto mode](https://www.anthropic.com/engineering/claude-code-auto-mode)
- [Creator of Claude Code reveals his workflow（InfoQ）](https://infoq.com/news/2026/01/claude-code-creator-workflow/)
- [How the Claude Code Team Works（Light Cone 整理）](https://engineeredintelligence.substack.com/p/how-the-claude-code-team-works)
- [Building Claude Code with Boris Cherny（Pragmatic Engineer）](https://newsletter.pragmaticengineer.com/p/building-claude-code-with-boris-cherny)
- [Anthropic's Claude Code team has 5 roles（Aakash Gupta，第三方整理）](https://aakashgupta.medium.com/anthropics-claude-code-team-has-5-roles-and-zero-job-titles-bf4860a389fc)
- §16：[Best practices for Claude Code](https://code.claude.com/docs/en/best-practices)、[Code intelligence plugins](https://code.claude.com/docs/en/plugins/code-intelligence)、[Kent Beck: Augmented Coding](https://newsletter.kentbeck.com/p/augmented-coding-beyond-the-vibes)、[HumanLayer: Advanced Context Engineering](https://www.humanlayer.dev/blog/advanced-context-engineering)、[Beads Best Practices](https://steve-yegge.medium.com/beads-best-practices-2db636b9760c)、[DORA 2025](https://dora.dev/dora-report-2025/)、[Mitchell Hashimoto: My AI Adoption Journey](https://mitchellh.com/writing/my-ai-adoption-journey)、[OpenAI: Harness engineering](https://openai.com/index/harness-engineering/)、[Böckeler: Understanding Spec-Driven Development](https://martinfowler.com/articles/exploring-gen-ai/sdd-3-tools.html)、[Huntley: Ralph](https://ghuntley.com/ralph/)、[obra/superpowers](https://github.com/obra/superpowers)、[METR 2026 update](https://metr.org/blog/2026-02-24-uplift-update/)
- Claude Code 官方文件：[hooks](https://code.claude.com/docs/en/hooks)、[skills](https://code.claude.com/docs/en/skills)、[sub-agents](https://code.claude.com/docs/en/sub-agents)、[model-config](https://code.claude.com/docs/en/model-config)、[costs](https://code.claude.com/docs/en/costs)、[memory](https://code.claude.com/docs/en/memory)、[permissions](https://code.claude.com/docs/en/permissions)、[permission-modes](https://code.claude.com/docs/en/permission-modes)、[settings](https://code.claude.com/docs/en/settings)、[worktrees](https://code.claude.com/docs/en/worktrees)、[statusline](https://code.claude.com/docs/en/statusline)、[advisor](https://code.claude.com/docs/en/advisor)、[code-review](https://code.claude.com/docs/en/code-review)

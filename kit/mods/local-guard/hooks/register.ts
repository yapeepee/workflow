import type { EngineInterface, Register } from 'claude-code'

import {
  baseName, cdTargets, extOf, findSecret, isInside, listed, normalize,
  parseCheckIgnore, parseStatusZ, PRIVATE, PRIVATE_ROOTS,
} from './rules'

// Keeps what is not project code on this machine, at the moment Claude writes it:
// - one repo per session: no edit in another repo (its hooks would never check
//   it), unless git ignores the file there, and no `cd` into one;
// - no new doc file where git can see it (notes belong in .solo/ or outside repos);
// - no secret in a file git can see.
// A file git ignores, or one outside every repo, is this machine's alone: allowed.

type Config = { docExts: Set<string>; checkOnStart: boolean }
type Placed = { path: string; dir: string }

const GUARD_FAILED =
  'local-guard：檢查本身出錯，為了安全先擋下這次寫入。請重試；一直發生的話，請使用者用 /plugin 暫時停用 local-guard。'

// Paths the person allowed for this session. A reload starts it over.
const session = { allowed: new Set<string>(), topOf: new Map<string, string | undefined>() }

export const register: Register = (on, options) => {
  const cfg: Config = {
    docExts: new Set(
      String(options.docExtensions ?? 'md,markdown,mdx,rst,adoc')
        .split(',')
        .map(s => s.trim().toLowerCase().replace(/^\./, ''))
        .filter(Boolean),
    ),
    checkOnStart: options.checkOnStart !== false,
  }

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'local-check',
      description: '稽核「只留本機」：git 看不看得到私人檔、本機防護與設定是否就位',
      argumentHint: '[all]',
    })
    await $.command.register({
      name: 'local-guard',
      description: '讓這個 session 寫入一個本來會被 local-guard 擋下的檔案',
      argumentHint: 'allow <path> | list',
    })
    const started = await next(e)
    if (cfg.checkOnStart) await warnOnStart($)
    return started
  })

  on('command.run', { command: 'local-check' }, async ($, e) => ({
    text: await localCheck($, (e.args ?? '').trim() === 'all'),
  }))

  // Only the person's own Enter (or their Remote Control client) may allow a path:
  // the engine stamps the origin, so a model or another plugin cannot claim it.
  on('command.run', { command: 'local-guard' }, async ($, e) => ({
    text: await allowCommand($, e.args ?? '', e.origin?.kind === 'composer' || e.origin?.kind === 'bridge'),
  }))

  on('tool.call', { tool: 'Write' }, async ($, e, next) => {
    const why = await judgeWrite($, cfg, e.file_path, e.content)
    return why === undefined ? next(e) : { deny: why }
  }).catch(($, e, next) => (next.called ? next(e) : { deny: GUARD_FAILED }))

  on('tool.call', { tool: 'Edit' }, async ($, e, next) => {
    const why = await judgeWrite($, cfg, e.file_path, e.new_string)
    return why === undefined ? next(e) : { deny: why }
  }).catch(($, e, next) => (next.called ? next(e) : { deny: GUARD_FAILED }))

  on('tool.call', { tool: 'NotebookEdit' }, async ($, e, next) => {
    const why = await judgeWrite($, cfg, e.notebook_path, e.new_source)
    return why === undefined ? next(e) : { deny: why }
  }).catch(($, e, next) => (next.called ? next(e) : { deny: GUARD_FAILED }))

  // A shell guard that breaks must not take the shell down with it.
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const why = await judgeCd($, e.command)
    if (why !== undefined) return { deny: why }
    const ran = await next(e)
    await warnIfMoved($)
    return ran
  }).catch(($, e, next) => next(e))
}

async function judgeWrite($: EngineInterface, cfg: Config, raw: string, text: string) {
  const placed = await place($, raw.startsWith('/') ? raw : `${await $.session.cwd()}/${raw}`)
  if (placed === undefined || session.allowed.has(placed.path)) return undefined
  const top = await gitTop($, placed.dir)
  if (top === undefined) return undefined // outside every repo: workspace notes, temp, ~/.claude
  const rel = placed.path.slice(top.length + 1)
  const isIgnored = await ignored($, top, rel)
  const own = await sessionTop($)
  if (own !== undefined && top !== own) {
    if (isIgnored) return undefined // a note the other repo keeps local, such as .solo/inbox.md
    return `local-guard：這個 session 屬於 ${baseName(own)}，${rel} 卻在另一個 repo（${top}），那邊的 hook 不會檢查這次修改。請在那個 repo 開新的 session 再改；只寫那邊被 git 排除的本機筆記不受限制。`
  }
  if (isIgnored) return undefined // only this machine sees it
  if (cfg.docExts.has(extOf(rel)) && !(await $.fs.exists(placed.path))) {
    return `local-guard：${rel} 是新的文件檔，而且 git 看得到它。Claude 寫的筆記、報告、計畫請放在 .solo/ 或工作區資料夾；這份文件如果真的要給團隊，請使用者執行 /local-guard allow ${rel} 之後再重試。`
  }
  const secret = findSecret(text)
  if (secret !== undefined) {
    return `local-guard：寫入 ${rel} 的內容第 ${secret.line} 行疑似 ${secret.kind}。secret 不該進 git 看得到的檔案，請改用環境變數、user secrets 或被排除的本機設定；確定是假資料的話，請使用者執行 /local-guard allow ${rel}。`
  }
  return undefined
}

async function judgeCd($: EngineInterface, command: string) {
  if (!/\bcd\b/.test(command)) return undefined
  const own = await sessionTop($)
  if (own === undefined) return undefined
  const home = (await $.env.get('HOME')) ?? ''
  for (const dir of cdTargets(command, await $.session.cwd(), home)) {
    const placed = await place($, dir)
    const top = placed === undefined ? undefined : await gitTop($, placed.dir)
    if (top !== undefined && top !== own) {
      return `local-guard：這個 session 屬於 ${baseName(own)}，不要 cd 進另一個 repo（${top}）：cd 之後 hook 會改用那個 repo 的設定，檢查就對不上了。要讀那邊的檔案，請用絕對路徑或 git -C "${top}"；要修改，請在那個 repo 開新的 session。`
    }
  }
  return undefined
}

async function warnIfMoved($: EngineInterface) {
  const own = await sessionTop($)
  if (own === undefined) return
  const placed = await place($, await $.session.cwd())
  if (placed === undefined || isInside(placed.path, own)) return
  const top = await gitTop($, placed.dir)
  if (top !== undefined && top !== own) {
    $.ui.toast(`local-guard：工作目錄移到了另一個 repo（${baseName(top)}），請 cd 回 ${own}`)
  }
}

// Where a path lands: the real path of its nearest existing folder, plus the rest.
async function place($: EngineInterface, raw: string): Promise<Placed | undefined> {
  let at = normalize(raw)
  const rest: string[] = []
  for (let i = 0; i < 64; i++) {
    const st = await $.fs.stat(at, { resolve: true }).catch(() => undefined)
    if (st?.realPath !== undefined) {
      const real = st.realPath.replace(/\/+$/, '') || '/'
      const path = rest.length ? `${real === '/' ? '' : real}/${rest.join('/')}` : real
      const dir = st.kind === 'dir' ? real : real.slice(0, real.lastIndexOf('/')) || '/'
      return { path, dir }
    }
    if (at === '/') return undefined
    const cut = at.lastIndexOf('/')
    rest.unshift(at.slice(cut + 1))
    at = cut <= 0 ? '/' : at.slice(0, cut)
  }
  return undefined
}

async function git($: EngineInterface, cwd: string, args: string[]) {
  return $.process.run(['git', '--no-optional-locks', '-C', cwd, ...args]).catch(() => undefined)
}

async function gitTop($: EngineInterface, dir: string): Promise<string | undefined> {
  if (session.topOf.has(dir)) return session.topOf.get(dir)
  const r = await git($, dir, ['rev-parse', '--show-toplevel'])
  const top = r?.exitCode === 0 ? r.stdout.trim() : undefined
  const real = top === undefined ? undefined : ((await $.fs.stat(top, { resolve: true }).catch(() => undefined))?.realPath ?? top)
  session.topOf.set(dir, real)
  return real
}

async function sessionTop($: EngineInterface) {
  const root = await place($, await $.session.root())
  return root === undefined ? undefined : gitTop($, root.dir)
}

async function ignored($: EngineInterface, top: string, rel: string) {
  return (await git($, top, ['check-ignore', '-q', '--', rel]))?.exitCode === 0
}

async function allowCommand($: EngineInterface, args: string, byPerson: boolean) {
  const [verb = '', ...rest] = args.trim().split(/\s+/)
  if (verb === 'list' || verb === '') {
    return session.allowed.size === 0
      ? 'local-guard：這個 session 沒有額外允許的路徑。'
      : `local-guard：這個 session 允許寫入：\n${[...session.allowed].map(p => `- ${p}`).join('\n')}`
  }
  if (verb !== 'allow' || rest.length === 0) return '用法：/local-guard allow <path>　或　/local-guard list'
  if (!byPerson) return 'local-guard：只有使用者親手輸入的 /local-guard allow 才算數。'
  const raw = rest.join(' ')
  const base = (await sessionTop($)) ?? (await $.session.cwd())
  const placed = await place($, raw.startsWith('/') ? raw : `${base}/${raw}`)
  if (placed === undefined) return `local-guard：找不到 ${raw} 的位置。`
  session.allowed.add(placed.path)
  return `local-guard：這個 session 允許寫入 ${placed.path}。`
}

async function warnOnStart($: EngineInterface) {
  const own = await sessionTop($)
  if (own === undefined) return
  const audit = await auditRepo($, own)
  if (audit.problems > 0) {
    $.ui.toast(`local-guard：${baseName(own)} 有 ${audit.problems} 個「只留本機」問題，執行 /local-check 看細節`)
  }
}

async function localCheck($: EngineInterface, all: boolean) {
  const own = await sessionTop($)
  const repos = all ? await nearbyRepos($, own, await $.session.root()) : own === undefined ? [] : [own]
  if (repos.length === 0) return 'local-check：這個 session 不在 git repo 裡；用 /local-check all 檢查附近的 repo。'
  const lines: string[] = []
  let problems = 0
  let notes = 0
  for (const top of repos) {
    const audit = await auditRepo($, top)
    problems += audit.problems
    notes += audit.notes
    lines.push(`${baseName(top)}（${top}）`, ...audit.lines.map(l => `  ${l}`))
  }
  const global = await auditGlobal($)
  problems += global.problems
  notes += global.notes
  lines.push('這台電腦', ...global.lines.map(l => `  ${l}`))
  lines.push(problems === 0 ? `結果：沒有問題${notes ? `，${notes} 個提醒` : ''}。` : `結果：${problems} 個問題、${notes} 個提醒。`)
  return lines.join('\n')
}

async function auditRepo($: EngineInterface, top: string) {
  const lines: string[] = []
  let problems = 0
  let notes = 0
  const status = await git($, top, ['status', '--porcelain=v1', '-z', '--untracked-files=all'])
  const entries = parseStatusZ(status?.stdout ?? '')
  const visible = entries.filter(x => PRIVATE.test(x.path)).map(x => x.path)
  if (visible.length) {
    problems += visible.length
    lines.push(`✘ git 看得到 ${visible.length} 個私人檔：${listed(visible)}`)
  } else lines.push('✔ git 看不到任何 Claude/AI 私人檔')

  const docs = entries.filter(x => x.code === '??' && /\.(md|markdown|mdx|rst|adoc)$/i.test(x.path) && !PRIVATE.test(x.path))
  if (docs.length) {
    notes += 1
    lines.push(`⚠ ${docs.length} 個新文件在 git 看得到的位置：${listed(docs.map(x => x.path))}（團隊要的就留著，否則移到 .solo/）`)
  }

  const files = await git($, top, ['ls-files', '-z'])
  const tracked = (files?.stdout ?? '').split('\0').filter(p => p !== '' && PRIVATE.test(p))
  if (tracked.length) {
    notes += 1
    lines.push(`⚠ 團隊的 repo 追蹤了 ${listed(tracked)}：這些不是私人檔，Claude 不該改它們`)
  }

  const present: string[] = []
  for (const p of PRIVATE_ROOTS) if (await $.fs.exists(`${top}/${p}`)) present.push(p)
  if (present.length) {
    const how = parseCheckIgnore((await git($, top, ['check-ignore', '-v', '--', ...present]))?.stdout ?? '')
    const hidden = present.filter(p => how.has(p))
    if (hidden.length) lines.push(`✔ 本機私人檔已隱藏：${hidden.map(p => `${p}（${how.get(p)}）`).join('、')}`)
  }

  const hookRel = (await git($, top, ['rev-parse', '--git-path', 'hooks/pre-commit']))?.stdout.trim() ?? '.git/hooks/pre-commit'
  const hookPath = hookRel.startsWith('/') ? hookRel : `${top}/${hookRel}`
  // host commands, not $.fs: the engine does not let a mod read inside .git/
  const exitOf = async (argv: string[]) => (await $.process.run(argv).catch(() => undefined))?.exitCode
  if ((await exitOf(['test', '-f', hookPath])) !== 0) {
    notes += 1
    lines.push('⚠ 沒有本機 pre-commit 防護（選用：commit 時擋下私人檔和新文件）')
  } else if ((await exitOf(['grep', '-q', 'Keeps Claude/AI files', hookPath])) !== 0) {
    lines.push('· 這個 repo 有自己的 pre-commit hook，不是 local-guard 的版本')
  } else if ((await exitOf(['test', '-x', hookPath])) === 0) {
    lines.push('✔ 本機 pre-commit 防護已啟用')
  } else {
    notes += 1
    lines.push(`⚠ pre-commit hook 沒有執行權限：chmod +x "${hookPath}"`)
  }

  const packs = await git($, top, ['grep', '-l', '-E', '<NoDefaultExcludes>[[:space:]]*true', '--', '*.csproj'])
  const packers = (packs?.stdout ?? '').split('\n').filter(Boolean)
  if (packers.length && present.length) {
    problems += 1
    lines.push(`✘ ${listed(packers)} 用 NoDefaultExcludes 打包整個資料夾：在這裡本機 dotnet pack 會把 ${listed(present)} 一起包進去。私人檔移出這個 repo，或只從乾淨的 clone 打包`)
  }
  return { lines, problems, notes }
}

async function auditGlobal($: EngineInterface) {
  const lines: string[] = []
  let notes = 0
  const attribution = await $.settings.read({ key: 'attribution' }).catch(() => undefined)
  const a = attribution as { commit?: unknown; pr?: unknown } | false | undefined
  if (a === false || (typeof a === 'object' && a !== null && a.commit === '' && a.pr === '')) {
    lines.push('✔ commit 和 PR 不加 Claude 署名')
  } else {
    notes += 1
    lines.push('⚠ Claude 做的 commit 或 PR 會加上署名：在 ~/.claude/settings.json 設 "attribution": {"commit": "", "pr": ""}')
  }
  const home = (await $.env.get('HOME')) ?? '/'
  const quote = await git($, home, ['config', '--global', '--get', 'core.quotepath'])
  if (quote?.stdout.trim() === 'false') lines.push('✔ core.quotepath=false（中文路徑在 git 輸出裡不會變成跳脫碼）')
  else {
    notes += 1
    lines.push('⚠ core.quotepath 不是 false：中文路徑在 git 輸出裡會變成跳脫碼，比對檔名的工具會看漏（git config --global core.quotepath false）')
  }
  const email = await git($, home, ['config', '--get', 'user.email'])
  if (email?.exitCode === 0 && email.stdout.trim() !== '') lines.push(`✔ git user.email：${email.stdout.trim()}`)
  else {
    notes += 1
    lines.push('⚠ git 沒有設定 user.email：你自己 commit 時會失敗')
  }
  return { lines, problems: 0, notes }
}

// Repos two levels down from the session's folder when it is in no repo, else from
// the repo's parent and grandparent. Never the home folder itself or above it:
// listing ~/Documents or ~/Desktop would raise macOS privacy prompts.
async function nearbyRepos($: EngineInterface, own: string | undefined, root: string) {
  const found = new Set<string>(own === undefined ? [] : [own])
  const home = ((await $.env.get('HOME')) ?? '').replace(/\/+$/, '')
  const up = (p: string) => p.slice(0, p.lastIndexOf('/')) || '/'
  const bases = own === undefined ? [root] : [up(own), up(up(own))]
  for (const base of bases) {
    if (base === '/' || (home !== '' && isInside(home, base))) continue
    for (const a of await dirs($, base)) {
      if (await $.fs.exists(`${a}/.git`)) found.add(a)
      else for (const b of await dirs($, a)) if (await $.fs.exists(`${b}/.git`)) found.add(b)
    }
  }
  return [...found].sort().slice(0, 30)
}

async function dirs($: EngineInterface, dir: string) {
  const entries = await $.fs.list(dir).catch(() => [])
  return entries
    .filter(x => x.kind === 'dir' && !x.name.startsWith('.') && !['node_modules', 'bin', 'obj'].includes(x.name))
    .map(x => `${dir}/${x.name}`)
}

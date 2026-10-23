import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { ChangeDiff, ChangeRow } from '../types'

// What a teammate would see in `git status`, with what this session touched marked:
// ignored files (the kit's, notes) never show, because git status skips them.

const PANE = 'session-changes'
const TITLE = '本 session 改動'
const DIFF_LINES = 400

const rows = atom({ plugin: 'session-changes', key: 'rows' } as const, [] as ChangeRow[])
const branch = atom({ plugin: 'session-changes', key: 'branch' } as const, '')
const diff = atom({ plugin: 'session-changes', key: 'diff' } as const, null as ChangeDiff | null)
const onlyTouched = atom({ plugin: 'session-changes', key: 'onlyTouched' } as const, false)
const notice = atom({ plugin: 'session-changes', key: 'notice' } as const, null as string | null)

// Repo-relative paths the tools wrote this session; a reload starts it over.
const session = { touched: new Set<string>(), opened: false, topOf: new Map<string, string | undefined>() }

export const register: Register = (on, options) => {
  const autoOpen = options.autoOpen !== false

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'changes', description: '在側欄看這個 session 改了哪些檔案，點檔名看 diff' })
    const started = await next(e)
    await refresh($)
    return started
  })

  on('command.run', { command: 'changes' }, async $ => {
    await refresh($)
    const placed = await $.ui.open({ id: PANE, title: TITLE })
    session.opened = true
    return { text: await summary($, placed.isPlaced) }
  })

  on('tool.call', { tool: 'Write' }, async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny === undefined && ran.isError !== true) await touched($, e.file_path, autoOpen)
    return ran
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: 'Edit' }, async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny === undefined && ran.isError !== true) await touched($, e.file_path, autoOpen)
    return ran
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: 'NotebookEdit' }, async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny === undefined && ran.isError !== true) await touched($, e.notebook_path, autoOpen)
    return ran
  }).catch(($, e, next) => next(e))

  // commands, migrations and formatters change files too: catch up once per turn
  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (e.agentId === undefined) await refresh($)
    return done
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Code, Text } = $.ui.resolve(e)
    const all = await read($, rows)
    const only = await read($, onlyTouched)
    const open = await read($, diff)
    const head = await read($, branch)
    const note = await read($, notice)
    const shown = only ? all.filter(r => r.touched) : all
    const plus = shown.reduce((n, r) => n + (r.added ?? 0), 0)
    const minus = shown.reduce((n, r) => n + (r.deleted ?? 0), 0)
    const room = Math.max(20, (e.props.bodyColumns ?? 60) - 16)

    return (
      <Box flexDirection="column">
        <Text bold>
          {head ? `${head} · ` : ''}
          {shown.length} 個檔案 +{plus} −{minus}
        </Text>
        {note !== null && <Text dimColor>{note}</Text>}
        {note === null && shown.length === 0 && (
          <Text dimColor>{only ? '這個 session 還沒改任何檔案。' : '沒有未 commit 的改動。'}</Text>
        )}
        {shown.map(r => (
          <Button key={r.path} plain onPress={() => select($, r.path)}>
            {r.touched ? '● ' : '  '}
            {r.code.padEnd(2)} {fit(r.path, room)} <Text color="diffAdded">+{r.added ?? '?'}</Text>{' '}
            <Text color="diffRemoved">−{r.deleted ?? '?'}</Text>
          </Button>
        ))}
        <Box>
          <Button key="refresh" label="重新整理" onPress={() => refresh($)} />
          <Button key="filter" label={only ? '顯示全部' : '只看這個 session'} onPress={() => update($, onlyTouched, v => !v)} />
        </Box>
        {open !== null && (
          <Text dimColor>
            {open.path}
            {open.isTruncated ? `（只顯示前 ${DIFF_LINES} 行）` : ''}
          </Text>
        )}
        {open !== null && <Code source={open.source || '(沒有差異)'} path={open.path} format="diff" />}
      </Box>
    )
  })
}

async function touched($: EngineInterface, raw: string, autoOpen: boolean) {
  const top = await repoTop($)
  if (top === undefined) return
  const real = (await $.fs.stat(raw, { resolve: true }).catch(() => undefined))?.realPath ?? raw
  if (!real.startsWith(`${top}/`)) return
  session.touched.add(real.slice(top.length + 1))
  await refresh($)
  if (autoOpen && !session.opened) {
    session.opened = true
    await $.ui.open({ id: PANE, title: TITLE }).catch(() => undefined)
  }
}

async function refresh($: EngineInterface) {
  const top = await repoTop($)
  if (top === undefined) {
    await update($, rows, () => [])
    await update($, notice, () => '這個 session 不在 git repo 裡。')
    return
  }
  const head = await git($, top, ['rev-parse', '--abbrev-ref', 'HEAD'])
  const status = await git($, top, ['status', '--porcelain=v1', '-z', '--untracked-files=all'])
  const numstat = await git($, top, ['diff', '--numstat', '-z', 'HEAD'])
  const counts = parseNumstatZ(numstat?.stdout ?? '')
  const list: ChangeRow[] = []
  let untrackedRead = 0
  for (const s of parseStatusZ(status?.stdout ?? '')) {
    const c = counts.get(s.path)
    let added = c?.added ?? null
    let deleted = c?.deleted ?? null
    if (s.code === '??' && untrackedRead < 100) {
      untrackedRead += 1
      const st = await $.fs.stat(`${top}/${s.path}`).catch(() => undefined)
      const text = st !== undefined && st.size <= 1_000_000 ? await $.fs.read(`${top}/${s.path}`).catch(() => undefined) : undefined
      added = typeof text === 'string' ? lineCount(text) : null
      deleted = 0
    }
    list.push({ path: s.path, code: s.code.trim() || '?', added, deleted, touched: session.touched.has(s.path) })
  }
  list.sort((a, b) => Number(b.touched) - Number(a.touched))
  await update($, rows, () => list.slice(0, 200))
  await update($, branch, () => head?.stdout.trim() ?? '')
  await update($, notice, () => null)
}

async function select($: EngineInterface, path: string) {
  const current = await read($, diff)
  if (current?.path === path) {
    await update($, diff, () => null)
    return
  }
  const top = await repoTop($)
  if (top === undefined) return
  const row = (await read($, rows)).find(r => r.path === path)
  const out =
    row?.code === '??'
      ? await git($, top, ['diff', '--no-index', '--no-color', '--', '/dev/null', path])
      : await git($, top, ['diff', '--no-color', 'HEAD', '--', path])
  const lines = (out?.stdout ?? '').split('\n')
  const isTruncated = lines.length > DIFF_LINES
  await update($, diff, () => ({ path, source: lines.slice(0, DIFF_LINES).join('\n'), isTruncated }))
}

async function summary($: EngineInterface, isPlaced: boolean) {
  const list = await read($, rows)
  const mine = list.filter(r => r.touched).length
  const pane = isPlaced ? '側欄已打開。' : '這個介面沒有地方放側欄。'
  return `這個 session 改了 ${mine} 個檔案；未 commit 的共 ${list.length} 個。${pane}`
}

async function git($: EngineInterface, cwd: string, args: string[]) {
  return $.process.run(['git', '--no-optional-locks', '-C', cwd, ...args]).catch(() => undefined)
}

async function repoTop($: EngineInterface) {
  const root = await $.session.root()
  if (session.topOf.has(root)) return session.topOf.get(root)
  const r = await git($, root, ['rev-parse', '--show-toplevel'])
  const top = r?.exitCode === 0 ? r.stdout.trim() : undefined
  const real = top === undefined ? undefined : ((await $.fs.stat(top, { resolve: true }).catch(() => undefined))?.realPath ?? top)
  session.topOf.set(root, real)
  return real
}

// `git status --porcelain=v1 -z`: "XY path", a rename or copy followed by its old path.
export function parseStatusZ(out: string): { code: string; path: string }[] {
  const parts = out.split('\0')
  const entries: { code: string; path: string }[] = []
  for (let i = 0; i < parts.length; i++) {
    const s = parts[i]
    if (!s || s.length < 4) continue
    const code = s.slice(0, 2)
    entries.push({ code, path: s.slice(3) })
    if (code[0] === 'R' || code[0] === 'C') i++
  }
  return entries
}

// `git diff --numstat -z`: "added<TAB>deleted<TAB>path", a rename as an empty path then old and new.
export function parseNumstatZ(out: string) {
  const counts = new Map<string, { added: number | null; deleted: number | null }>()
  const parts = out.split('\0')
  for (let i = 0; i < parts.length; i++) {
    const m = /^(-|\d+)\t(-|\d+)\t(.*)$/s.exec(parts[i] ?? '')
    if (!m) continue
    let path = m[3] ?? ''
    if (path === '') {
      path = parts[i + 2] ?? ''
      i += 2
    }
    counts.set(path, { added: m[1] === '-' ? null : Number(m[1]), deleted: m[2] === '-' ? null : Number(m[2]) })
  }
  return counts
}

export function lineCount(text: string) {
  if (text === '') return 0
  return text.split('\n').length - (text.endsWith('\n') ? 1 : 0)
}

// Keeps the end of a long path, where the file name is.
export function fit(path: string, room: number) {
  return path.length <= room ? path.padEnd(room) : `…${path.slice(path.length - room + 1)}`
}

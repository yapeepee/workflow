import { expect, mock, test } from 'claude-code/testing'
import type { On, UiNotifyResult } from 'claude-code'

const REPO = '/w/my-app'
const QUESTION = {
  question: '要用哪一個？',
  header: '選擇',
  options: [
    { label: 'A', description: 'a' },
    { label: 'B', description: 'b' },
  ],
  multiSelect: false,
}

// Stands for the engine beneath the mod: the session's repo, the notification
// channel this terminal has, and the host commands the fallback runs.
function world(on: On, channel: UiNotifyResult, os = 'Darwin') {
  const notes: { text: string; title?: string }[] = []
  const runs: string[][] = []
  on('session.repo', () => ({ value: { root: REPO, origin: null } }))
  on('session.cwd', () => ({ value: REPO }))
  on('ui.notify', (_$, e) => {
    notes.push({ text: e.text, title: e.title })
    return { value: channel }
  })
  on('process.run', (_$, e) => {
    runs.push([...e.argv])
    const stdout = e.argv[0] === 'uname' ? `${os}\n` : ''
    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('tool.call', () => ({ result: {} }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_$, e) => ({ text: e.answer }))
  on('classic.PermissionRequest', () => ({}))
  return { notes, runs }
}

const turn = (durationMs: number, extra: Record<string, unknown> = {}) => ({
  turnId: 't1',
  answer: '## 修好了 **Login**\n全部測試通過。',
  durationMs,
  isAborted: false,
  reason: 'answer' as const,
  ...extra,
})

test('a long turn notifies with the repo, the outcome and how long it took', async ($, on) => {
  const w = world(on, { isSent: true, channel: 'iterm2' })
  await $.turn.complete(turn(83_000))
  expect(w.notes).toEqual([{ text: '修好了 Login', title: 'my-app · 完成（1m 23s）' }])
  expect(w.runs).toEqual([])
})

test('a short turn, an aborted one and a subagent turn stay quiet', async ($, on) => {
  const w = world(on, { isSent: true, channel: 'iterm2' })
  await $.turn.complete(turn(10_000))
  await $.turn.complete(turn(90_000, { isAborted: true }))
  await $.turn.complete(turn(90_000, { agentId: 'sub-1' }))
  expect(w.notes).toEqual([])
})

test('a reply that ends with a question says Claude is asking', async ($, on) => {
  const w = world(on, { isSent: true, channel: 'kitty' })
  await $.turn.complete(turn(50_000, { answer: '兩種做法都可以，要用哪一種？' }))
  expect(w.notes[0]?.title).toBe('my-app · Claude 在問你（50s）')
})

test('a terminal with no channel falls back to the macOS notification center', async ($, on) => {
  const w = world(on, { isSent: false, reason: 'no-channel' })
  await $.turn.complete(turn(60_000))
  expect(w.runs.map(r => r[0])).toEqual(['uname', 'osascript'])
  expect(w.runs[1]?.[2]).toContain('with title "my-app · 完成（1m 00s）"')
})

test('a bell alone, with no text shown, also gets a notification-center banner', async ($, on) => {
  const bell = world(on, { isSent: true, channel: 'terminal_bell' })
  await $.turn.complete(turn(60_000))
  expect(bell.runs.map(r => r[0])).toEqual(['uname', 'osascript'])
})

test('notifications the person turned off are respected', async ($, on) => {
  const w = world(on, { isSent: false, reason: 'disabled' })
  await $.turn.complete(turn(60_000))
  expect(w.runs).toEqual([])
})

test('the fallback is off where the host is not a Mac', async ($, on) => {
  const w = world(on, { isSent: false, reason: 'no-channel' }, 'Linux')
  await $.turn.complete(turn(60_000))
  expect(w.runs.map(r => r[0])).toEqual(['uname'])
})

test('a question after a long run notifies; one asked right away does not', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000 })
  const w = world(on, { isSent: true, channel: 'iterm2' })
  await $.turn.start({ text: '開始', turnId: 't1' })
  await clock.advance(10_000)
  await $.tool.call({ tool: 'AskUserQuestion', questions: [QUESTION] })
  expect(w.notes).toEqual([])
  await clock.advance(60_000)
  await $.tool.call({ tool: 'AskUserQuestion', questions: [QUESTION] })
  expect(w.notes).toEqual([{ text: '要用哪一個？', title: 'my-app · Claude 在等你回答' }])
})

test('a permission dialog after a long run notifies, unless a settings hook decided', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  const w = world(on, { isSent: true, channel: 'iterm2' })
  await $.turn.start({ text: '開始', turnId: 't1' })
  await clock.advance(120_000)
  await $.classic.PermissionRequest({ tool_name: 'Bash', tool_input: { command: 'git push origin HEAD' } })
  expect(w.notes).toEqual([{ text: 'Bash：git push origin HEAD', title: 'my-app · Claude 在等你核准' }])
})

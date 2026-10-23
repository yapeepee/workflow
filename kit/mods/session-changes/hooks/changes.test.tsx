import { expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { fit, lineCount, parseNumstatZ } from './register'

const ROOT = '/w/app'
const PANE = {
  plugin: 'session-changes',
  component: 'Pane',
  requestId: 'session-changes',
  props: {
    title: '本 session 改動',
    isFocused: false,
    bodyColumns: 70,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const

const DIFF_A = 'diff --git a/src/A.cs b/src/A.cs\n--- a/src/A.cs\n+++ b/src/A.cs\n@@ -1,2 +1,4 @@\n class A {\n-  int x;\n+  int x = 1;\n+  int y;\n+  int z;\n }\n'

function world(on: On) {
  const opened: string[] = []
  const out = (exitCode: number, stdout = '') => ({
    value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
  })
  on('session.root', () => ({ value: ROOT }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('ui.open', (_$, e) => {
    opened.push(e.id)
    return { value: { isPlaced: true } }
  })
  on('fs.stat', (_$, e) => ({ value: { kind: e.path === ROOT ? 'dir' : 'file', size: 10, mtimeMs: 0, isLink: false, realPath: e.path } }))
  on('fs.read', (_$, e) => ({ value: e.path.endsWith('New.cs') ? 'class New {}\n// two\n' : '' }))
  on('process.run', (_$, e) => {
    const args = [...e.argv].slice(4) // git --no-optional-locks -C <dir> ...
    if (args[0] === 'rev-parse' && args[1] === '--show-toplevel') return out(0, `${ROOT}\n`)
    if (args[0] === 'rev-parse' && args[1] === '--abbrev-ref') return out(0, 'feature/x\n')
    if (args[0] === 'status') return out(0, ' M src/A.cs\0?? src/New.cs\0')
    if (args[0] === 'diff' && args[1] === '--numstat') return out(0, '3\t1\tsrc/A.cs\0')
    if (args[0] === 'diff' && args.includes('src/A.cs')) return out(0, DIFF_A)
    return out(1)
  })
  on('tool.call', () => ({ result: {} }))
  on('turn.complete', (_$, e) => ({ text: e.answer }))
  return { opened }
}

for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
  test(`${surface}: the pane marks what this session wrote and counts every file`, async ($, on) => {
    world(on)
    await $.session.start({ cwd: ROOT, surface, isInteractive: true })
    await $.tool.call({ tool: 'Edit', file_path: `${ROOT}/src/A.cs`, old_string: 'int x;', new_string: 'int x = 1;' })
    const ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ type: 'Text', text: /feature\/x · 2 個檔案 \+5 −1/ }))?.text).toContain('2 個檔案')
    const mine = await ui.find({ type: 'Button', key: 'src/A.cs' })
    expect(mine?.text).toMatch(/^● M\s+src\/A\.cs/)
    expect(mine?.text).toContain('+3')
    expect((await ui.find({ type: 'Button', key: 'src/New.cs' }))?.text).toMatch(/^ {2}\?\?\s+src\/New\.cs.*\+2/)
    await ui.unmount()
  })
}

test('pressing a file shows its diff, pressing it again hides it', async ($, on) => {
  world(on)
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'src/A.cs' })
  expect((await ui.find({ type: 'Code' }))?.text).toContain('+  int y;')
  await ui.press({ key: 'src/A.cs' })
  expect(await ui.find({ type: 'Code' })).toBeUndefined()
  await ui.unmount()
})

test('the filter keeps only what this session wrote', async ($, on) => {
  world(on)
  await $.session.start({ cwd: ROOT, surface: 'desktop', isInteractive: true })
  await $.tool.call({ tool: 'Write', file_path: `${ROOT}/src/A.cs`, content: 'class A {}' })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'filter' })
  expect(await ui.find({ type: 'Button', key: 'src/A.cs' })).toBeDefined()
  expect(await ui.find({ type: 'Button', key: 'src/New.cs' })).toBeUndefined()
  await ui.unmount()
})

test('the first write opens the pane once; /changes reports and opens it', async ($, on) => {
  const w = world(on)
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Write', file_path: `${ROOT}/src/A.cs`, content: 'a' })
  await $.tool.call({ tool: 'Write', file_path: `${ROOT}/src/A.cs`, content: 'b' })
  expect(w.opened).toEqual(['session-changes'])
  const { text } = await $.command.run({ command: 'changes', args: '' })
  expect(text).toBe('這個 session 改了 1 個檔案；未 commit 的共 2 個。側欄已打開。')
})

test('numstat, line counts and path fitting', () => {
  expect(parseNumstatZ('3\t1\tsrc/A.cs\0-\t-\tlogo.png\0002\t0\t\0old.cs\0new.cs\0').get('new.cs')).toEqual({ added: 2, deleted: 0 })
  expect(parseNumstatZ('-\t-\tlogo.png\0').get('logo.png')).toEqual({ added: null, deleted: null })
  expect([lineCount(''), lineCount('a\n'), lineCount('a\nb')]).toEqual([0, 1, 2])
  expect(fit('src/very/long/path/File.cs', 12)).toBe('…ath/File.cs')
  expect(fit('src/A.cs', 12)).toBe('src/A.cs    ')
})

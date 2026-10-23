import { describe as group, expect, mock, test } from 'claude-code/testing'
import type { On, ProcessRunResult } from 'claude-code'

import { cdTargets, extOf, findSecret, isInside, normalize, parseCheckIgnore, parseStatusZ } from './rules'

// Built at run time, so this file holds no key-shaped text for secret scanners to flag.
const AWS_KEY = ['AKIA', 'Z'.repeat(16)].join('')
const GITLAB_TOKEN = ['glpat', 'x'.repeat(20)].join('-')

const HOME = '/u'
const APP = '/w/app'
const LIB = '/w/lib'
const HOOK = `${APP}/.git/hooks/pre-commit`
const START = { cwd: APP, surface: 'terminal', isInteractive: true } as const

type Hook = 'ours' | 'not-executable' | 'theirs' | 'none'
type World = {
  cwd: string
  status: string
  hook: Hook
  packers: string[]
  brokenGit: boolean
  toasts: string[]
  commands: string[]
  fsPaths: string[]
}

const out = (exitCode: number, stdout = '') => ({
  value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
})

const ignoredIn = (top: string, rel: string) =>
  top === APP ? rel === '.solo' || rel.startsWith('.solo/') : top === LIB && rel.startsWith('notes/')

// Stands for the machine beneath the mod: the session's repo (app) beside another one (lib),
// git, and the host commands. `build/` is touched by one test only, so no cached repo lookup hides it.
function world(on: On, files: string[] = []): World {
  const dirs = new Set(['/', '/w', APP, `${APP}/src`, `${APP}/build`, `${APP}/.solo`, LIB, `${LIB}/src`, `${LIB}/notes`, '/tmp', HOME])
  const known = new Set([`${APP}/src/A.cs`, `${APP}/README.md`, `${LIB}/src/B.cs`, ...files])
  const w: World = { cwd: APP, status: '', hook: 'ours', packers: [], brokenGit: false, toasts: [], commands: [], fsPaths: [] }
  mock.env(on, { HOME })
  on('session.root', () => ({ value: APP }))
  on('session.cwd', () => ({ value: w.cwd }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', (_$, e) => {
    w.commands.push(e.name)
    return { value: { command: e.name } }
  })
  on('ui.toast', (_$, e) => {
    w.toasts.push(e.text)
    return { value: undefined }
  })
  on('settings.read', () => ({ value: { attribution: { commit: '', pr: '' } } }))
  on('fs.stat', (_$, e) => {
    w.fsPaths.push(e.path)
    const kind = dirs.has(e.path) ? 'dir' : known.has(e.path) ? 'file' : undefined
    if (kind === undefined) throw new Error(`ENOENT: ${e.path}`)
    return { value: { kind, size: 1, mtimeMs: 0, isLink: false, realPath: e.path } }
  })
  on('fs.exists', (_$, e) => {
    w.fsPaths.push(e.path)
    return { value: dirs.has(e.path) || known.has(e.path) }
  })
  on('process.run', (_$, e) => run(w, [...e.argv]))
  on('tool.call', () => ({ result: {} }))
  return w
}

function run(w: World, argv: string[]) {
  const [cmd, flag] = argv
  if (cmd === 'test') return out(flag === '-f' ? Number(w.hook === 'none') : Number(w.hook !== 'ours'))
  if (cmd === 'grep') return out(w.hook === 'ours' || w.hook === 'not-executable' ? 0 : 1)
  const cwd = argv[3] ?? ''
  const args = argv.slice(4) // git --no-optional-locks -C <dir> ...
  const top = isInside(cwd, APP) ? APP : isInside(cwd, LIB) ? LIB : undefined
  switch (args[0]) {
    case 'rev-parse':
      if (args[1] === '--git-path') return out(0, `.git/${args[2]}\n`)
      // git answering without its output: the guard has to fail closed
      if (w.brokenGit) return { value: { exitCode: 0 } as ProcessRunResult }
      return top === undefined ? out(128) : out(0, `${top}\n`)
    case 'check-ignore': {
      const hidden = args.slice(args.indexOf('--') + 1).filter(p => top !== undefined && ignoredIn(top, p))
      return out(hidden.length ? 0 : 1, args[1] === '-v' ? hidden.map(p => `${top}/.git/info/exclude:7:${p}\t${p}\n`).join('') : '')
    }
    case 'status':
      return out(0, w.status)
    case 'ls-files':
      return out(0, 'src/A.cs\0README.md\0')
    case 'grep':
      return w.packers.length ? out(0, `${w.packers.join('\n')}\n`) : out(1)
    case 'config':
      return out(0, args.includes('core.quotepath') ? 'false\n' : 'dev@example.com\n')
  }
  return out(1)
}

group('rules', () => {
  test('secrets are found with their line; plain text is not', () => {
    expect(findSecret(`a\nb\nkey=${AWS_KEY}`)).toEqual({ kind: 'AWS access key', line: 3 })
    expect(findSecret(`token: ${GITLAB_TOKEN}`)?.kind).toBe('GitLab token')
    expect(findSecret('const answer = 42')).toBeUndefined()
  })

  test('cd targets follow each hop, quotes and ~, and skip cd -', () => {
    expect(cdTargets('cd src && cd ../../lib; cd "/w/x y" && cd ~/notes && cd -', APP, HOME)).toEqual([
      `${APP}/src`,
      LIB,
      '/w/x y',
      `${HOME}/notes`,
    ])
  })

  test('paths, extensions and git output are read as git writes them', () => {
    expect(normalize('/w/app/./src/../lib//x')).toBe('/w/app/lib/x')
    expect([extOf('/a/Guide.MD'), extOf('/a/.env'), extOf('/a/Makefile')]).toEqual(['md', '', ''])
    expect(parseStatusZ(' M src/A.cs\0R  new.cs\0old.cs\0?? CLAUDE.md\0')).toEqual([
      { code: ' M', path: 'src/A.cs' },
      { code: 'R ', path: 'new.cs' },
      { code: '??', path: 'CLAUDE.md' },
    ])
    const how = parseCheckIgnore(`${APP}/.git/info/exclude:7:/.solo/\t.solo\n${APP}/.gitignore:3:.claude\t.claude\n`)
    expect([how.get('.solo'), how.get('.claude')]).toEqual(['.git/info/exclude', `${APP}/.gitignore`])
  })
})

group('writes', () => {
  test('a new doc git can see is refused; an existing doc, an ignored folder and a path outside repos are not', async ($, on) => {
    world(on)
    const fresh = await $.tool.call({ tool: 'Write', file_path: `${APP}/docs/guide.md`, content: '# Guide' })
    expect(fresh.deny).toContain('docs/guide.md 是新的文件檔')
    expect(fresh.deny).toContain('/local-guard allow docs/guide.md')
    const edit = await $.tool.call({ tool: 'Edit', file_path: `${APP}/README.md`, old_string: 'a', new_string: 'b' })
    const note = await $.tool.call({ tool: 'Write', file_path: `${APP}/.solo/plan.md`, content: '# Plan' })
    const outside = await $.tool.call({ tool: 'Write', file_path: '/tmp/notes.md', content: '# Notes' })
    expect([edit.deny, note.deny, outside.deny]).toEqual([undefined, undefined, undefined])
  })

  test('the doc extensions come from the options', { options: { docExtensions: 'txt' } }, async ($, on) => {
    world(on)
    const txt = await $.tool.call({ tool: 'Write', file_path: `${APP}/docs/notes.txt`, content: 'x' })
    const md = await $.tool.call({ tool: 'Write', file_path: `${APP}/docs/guide.md`, content: 'x' })
    expect(txt.deny).toContain('docs/notes.txt 是新的文件檔')
    expect(md.deny).toBeUndefined()
  })

  test('a secret in a file git can see is refused with its kind and line; an ignored file may hold one', async ($, on) => {
    world(on)
    const code = await $.tool.call({ tool: 'Write', file_path: `${APP}/src/config.ts`, content: `// keys\nconst key = '${AWS_KEY}'\n` })
    expect(code.deny).toContain('src/config.ts 的內容第 2 行疑似 AWS access key')
    const edit = await $.tool.call({ tool: 'Edit', file_path: `${APP}/src/A.cs`, old_string: 'x', new_string: `var t = "${GITLAB_TOKEN}";` })
    expect(edit.deny).toContain('GitLab token')
    const local = await $.tool.call({ tool: 'Write', file_path: `${APP}/.solo/keys.env`, content: `KEY=${AWS_KEY}` })
    expect(local.deny).toBeUndefined()
  })

  test('another repo is off limits unless git ignores the file there', async ($, on) => {
    world(on)
    const code = await $.tool.call({ tool: 'Write', file_path: `${LIB}/src/B.cs`, content: 'class B {}' })
    expect(code.deny).toContain(`這個 session 屬於 app，src/B.cs 卻在另一個 repo（${LIB}）`)
    const note = await $.tool.call({ tool: 'Write', file_path: `${LIB}/notes/todo.md`, content: '- [ ] x' })
    expect(note.deny).toBeUndefined()
  })

  test('a check that breaks refuses the write instead of letting it through', async ($, on) => {
    const w = world(on)
    w.brokenGit = true
    const r = await $.tool.call({ tool: 'Write', file_path: `${APP}/build/Gen.cs`, content: 'class Gen {}' })
    expect(r.deny).toContain('檢查本身出錯')
  })
})

group('shell', () => {
  test('cd into another repo is refused; cd inside the repo and plain commands run', async ($, on) => {
    world(on)
    const away = await $.tool.call({ tool: 'Bash', command: `cd ${LIB} && make` })
    expect(away.deny).toContain(`不要 cd 進另一個 repo（${LIB}）`)
    const relative = await $.tool.call({ tool: 'Bash', command: 'cd ../lib' })
    expect(relative.deny).toContain('不要 cd 進另一個 repo')
    const inside = await $.tool.call({ tool: 'Bash', command: 'cd src && dotnet build' })
    const plain = await $.tool.call({ tool: 'Bash', command: 'git status' })
    expect([inside.deny, plain.deny]).toEqual([undefined, undefined])
  })

  test('a shell left in another repo raises a toast', async ($, on) => {
    const w = world(on)
    w.cwd = `${LIB}/src`
    await $.tool.call({ tool: 'Bash', command: 'pushd ../../lib/src' })
    expect(w.toasts).toEqual([`local-guard：工作目錄移到了另一個 repo（lib），請 cd 回 ${APP}`])
  })
})

group('commands', () => {
  test("only the person's own /local-guard allow lets a refused path through", async ($, on) => {
    world(on)
    await $.session.start(START)
    const write = () => $.tool.call({ tool: 'Write', file_path: `${APP}/docs/allowed.md`, content: '# Team doc' })
    const byPlugin = await $.command.run({ command: 'local-guard', args: 'allow docs/allowed.md', origin: { kind: 'plugin', name: 'other-mod' } })
    expect(byPlugin.text).toContain('只有使用者親手輸入')
    expect((await write()).deny).toContain('docs/allowed.md 是新的文件檔')
    const byPerson = await $.command.run({ command: 'local-guard', args: 'allow docs/allowed.md', origin: { kind: 'composer' } })
    expect(byPerson.text).toBe(`local-guard：這個 session 允許寫入 ${APP}/docs/allowed.md。`)
    expect((await write()).deny).toBeUndefined()
    const list = await $.command.run({ command: 'local-guard', args: 'list', origin: { kind: 'composer' } })
    expect(list.text).toContain(`- ${APP}/docs/allowed.md`)
  })

  test('session start registers both commands and toasts private files git can see', async ($, on) => {
    const w = world(on, [`${APP}/CLAUDE.md`])
    w.status = '?? CLAUDE.md\0'
    await $.session.start(START)
    expect(w.commands).toEqual(['local-check', 'local-guard'])
    expect(w.toasts).toEqual(['local-guard：app 有 1 個「只留本機」問題，執行 /local-check 看細節'])
  })

  test('a clean repo starts quietly', async ($, on) => {
    const w = world(on)
    await $.session.start(START)
    expect(w.toasts).toEqual([])
  })

  test('/local-check reports what git can see, what is hidden, the pre-commit guard and this machine', async ($, on) => {
    const w = world(on, [`${APP}/CLAUDE.md`])
    w.status = ' M src/A.cs\0?? CLAUDE.md\0?? docs/new.md\0'
    await $.session.start(START)
    const text = (await $.command.run({ command: 'local-check', args: '' })).text ?? ''
    for (const line of [
      `app（${APP}）`,
      '✘ git 看得到 1 個私人檔：CLAUDE.md',
      '⚠ 1 個新文件在 git 看得到的位置：docs/new.md',
      '✔ 本機私人檔已隱藏：.solo（.git/info/exclude）',
      '✔ 本機 pre-commit 防護已啟用',
      '✔ commit 和 PR 不加 Claude 署名',
      '✔ git user.email：dev@example.com',
      '結果：1 個問題、1 個提醒。',
    ]) {
      expect(text).toContain(line)
    }
  })

  test('the pre-commit guard is checked with host commands, since a mod cannot read inside .git/', async ($, on) => {
    const w = world(on)
    await $.session.start(START)
    const report = async (hook: Hook) => {
      w.hook = hook
      return (await $.command.run({ command: 'local-check', args: '' })).text ?? ''
    }
    expect(await report('ours')).toContain('✔ 本機 pre-commit 防護已啟用')
    expect(await report('not-executable')).toContain(`⚠ pre-commit hook 沒有執行權限：chmod +x "${HOOK}"`)
    expect(await report('theirs')).toContain('· 這個 repo 有自己的 pre-commit hook')
    expect(await report('none')).toContain('⚠ 沒有本機 pre-commit 防護')
    expect(w.fsPaths.filter(p => p.includes('/.git/'))).toEqual([])
  })

  test('a project that packs its whole folder is flagged while private files sit in it', async ($, on) => {
    const w = world(on, [`${APP}/CLAUDE.md`])
    w.packers = ['src/App.csproj']
    await $.session.start(START)
    const text = (await $.command.run({ command: 'local-check', args: '' })).text ?? ''
    expect(text).toContain('✘ src/App.csproj 用 NoDefaultExcludes 打包整個資料夾：在這裡本機 dotnet pack 會把 .solo、CLAUDE.md 一起包進去')
  })
})

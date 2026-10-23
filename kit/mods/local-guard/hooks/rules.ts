// Pure rules: no `$`, so the tests can call them directly.

// Paths only this machine may hold: the kit's, Claude Code's own, AI notes.
export const PRIVATE =
  /(^|\/)(\.solo|\.claude|claude-analysis)\/|(^|\/)(CLAUDE|CLAUDE\.local|AGENTS)\.md$|(^|\/)\.mcp\.json$|^\.worktreeinclude$/

// Candidates /local-check looks for at a repo's root.
export const PRIVATE_ROOTS = ['.solo', '.claude', 'claude-analysis', 'CLAUDE.md', 'CLAUDE.local.md', 'AGENTS.md', '.mcp.json', '.worktreeinclude']

// High-confidence formats only: a guard that cries wolf gets switched off.
const SECRETS: { kind: string; re: RegExp }[] = [
  { kind: 'private key', re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY-----/ },
  { kind: 'AWS access key', re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/ },
  { kind: 'GitHub token', re: /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{60,})/ },
  { kind: 'GitLab token', re: /\bglpat-[A-Za-z0-9_-]{20,}/ },
  { kind: 'Slack token', re: /\bxox[abposr]-[A-Za-z0-9-]{10,}/ },
  { kind: 'Google API key', re: /\bAIza[0-9A-Za-z_-]{35}/ },
  { kind: 'Stripe live key', re: /\b(?:sk|rk)_live_[0-9A-Za-z]{16,}/ },
  { kind: 'Anthropic API key', re: /\bsk-ant-[A-Za-z0-9_-]{20,}/ },
  { kind: 'OpenAI API key', re: /\bsk-(?:proj-)?[A-Za-z0-9]{32,}/ },
  { kind: 'NuGet API key', re: /\boy2[a-z0-9]{43}\b/ },
  { kind: 'Azure storage key', re: /AccountKey=[A-Za-z0-9+/]{60,}/ },
  { kind: 'NuGet clear-text password', re: /ClearTextPassword"\s+value="(?![$%<{])[^"]{6,}"/ },
]

export function findSecret(text: string): { kind: string; line: number } | undefined {
  for (const { kind, re } of SECRETS) {
    const m = re.exec(text)
    if (m) return { kind, line: text.slice(0, m.index).split('\n').length }
  }
  return undefined
}

// The folders a command's `cd`s land in, in order; each relative one from the folder before it.
export function cdTargets(command: string, cwd: string, home: string): string[] {
  const out: string[] = []
  let dir = cwd
  const re = /(?:^|[;&|\n(]\s*)cd(?:\s+--)?\s+(?:"([^"]*)"|'([^']*)'|([^\s;&|)]+))/g
  for (const m of command.matchAll(re)) {
    const raw = m[1] ?? m[2] ?? m[3] ?? ''
    if (raw === '' || raw === '-') continue
    const expanded = raw === '~' ? home : raw.startsWith('~/') ? `${home}${raw.slice(1)}` : raw
    dir = normalize(expanded.startsWith('/') ? expanded : `${dir}/${expanded}`)
    out.push(dir)
  }
  return out
}

export function normalize(path: string): string {
  const parts: string[] = []
  for (const seg of path.split('/')) {
    if (seg === '' || seg === '.') continue
    if (seg === '..') parts.pop()
    else parts.push(seg)
  }
  return `/${parts.join('/')}`
}

export function extOf(path: string): string {
  const name = path.slice(path.lastIndexOf('/') + 1)
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
}

export const isInside = (path: string, root: string) => path === root || path.startsWith(`${root}/`)

export const baseName = (path: string) => path.slice(path.lastIndexOf('/') + 1) || path

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

// `git check-ignore -v`: "source:line:pattern<TAB>path", the source shortened to its file.
export function parseCheckIgnore(out: string): Map<string, string> {
  const hidden = new Map<string, string>()
  for (const line of out.split('\n')) {
    const tab = line.lastIndexOf('\t')
    if (tab < 0) continue
    const source = line.slice(0, tab).replace(/:\d+:.*$/, '')
    hidden.set(line.slice(tab + 1), source.replace(/^.*\/\.git\//, '.git/'))
  }
  return hidden
}

export const listed = (items: string[], max = 5) =>
  items.length <= max ? items.join('、') : `${items.slice(0, max).join('、')} 等 ${items.length} 個`

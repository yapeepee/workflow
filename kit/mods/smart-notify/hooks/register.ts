import type { EngineInterface, Register } from 'claude-code'

// Notifies only when you probably looked away: a main-loop turn that ran past
// `minSeconds`, or such a turn stopping to wait for an answer or an approval.
// Never hooks classic.Notification: $.ui.notify raises it, so that would echo.

type Config = { minMs: number; onWaiting: boolean; macFallback: boolean }

// Module state starts over on a reload, which only skips one notification.
const turn = { startedAt: undefined as number | undefined }
const host = { isMac: undefined as boolean | undefined }

export const register: Register = (on, options) => {
  const cfg: Config = {
    minMs: Number(options.minSeconds ?? 45) * 1000,
    onWaiting: options.onWaiting !== false,
    macFallback: options.macFallback !== false,
  }

  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) turn.startedAt = await $.clock.now()
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (e.agentId !== undefined) return done
    turn.startedAt = undefined
    if (!e.isAborted && e.durationMs >= cfg.minMs) {
      const asks = /[?？]\s*$/.test(e.answer.trim())
      const what = e.reason === 'error' ? '回合出錯' : asks ? 'Claude 在問你' : '完成'
      const title = `${await repoName($)} · ${what}（${formatDuration(e.durationMs)}）`
      await send($, cfg, title, firstLine(e.answer) || what)
    }
    return done
  })

  // A notifier never decides anything: when one of these fails, the call goes on.
  on('tool.call', { tool: 'AskUserQuestion' }, async ($, e, next) => {
    if (cfg.onWaiting && e.agentId === undefined && (await ranLong($, cfg))) {
      const question = e.questions[0]?.question ?? '有問題要問你'
      await send($, cfg, `${await repoName($)} · Claude 在等你回答`, question)
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('classic.PermissionRequest', async ($, e, next) => {
    const answer = await next(e)
    // a settings hook that already decided means no dialog is shown
    if (cfg.onWaiting && !e.agent_id && answer.decision === undefined && (await ranLong($, cfg))) {
      const title = `${await repoName($)} · Claude 在等你核准`
      await send($, cfg, title, `${e.tool_name}：${describe(e.tool_input)}`)
    }
    return answer
  }).catch(($, e, next) => next(e))
}

async function ranLong($: EngineInterface, cfg: Config) {
  const started = turn.startedAt
  return started !== undefined && (await $.clock.now()) - started >= cfg.minMs
}

async function repoName($: EngineInterface) {
  const repo = await $.session.repo().catch(() => null)
  const dir = repo?.root ?? (await $.session.cwd())
  return dir.split('/').filter(Boolean).pop() ?? 'Claude'
}

async function send($: EngineInterface, cfg: Config, title: string, text: string) {
  const sent = await $.ui.notify(text, { title }).catch(() => undefined)
  if (sent === undefined) return // a plugin above refused it
  if (sent.isSent && sent.channel !== 'terminal_bell') return
  if (!sent.isSent && sent.reason !== 'no-channel') return // off, headless or refused: respect it
  if (!cfg.macFallback) return
  host.isMac ??= await $.process
    .run(['uname', '-s'])
    .then(r => r.stdout.trim() === 'Darwin')
    .catch(() => false)
  if (!host.isMac) return
  await $.process
    .run(['osascript', '-e', `display notification ${appleQuote(text)} with title ${appleQuote(title)}`])
    .catch(() => undefined)
}

function appleQuote(s: string) {
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

export function formatDuration(ms: number) {
  const s = Math.round(ms / 1000)
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`
}

// The answer's first readable line, markdown marks dropped, cut for a banner.
export function firstLine(answer: string) {
  const line =
    answer
      .split('\n')
      .map(l => l.replace(/^[\s#>*\-|`]+|[*`|]+$/g, '').replace(/\*\*|`/g, '').trim())
      .find(l => l.length > 0) ?? ''
  return line.length > 120 ? `${line.slice(0, 119)}…` : line
}

function describe(input: unknown) {
  const i = (input ?? {}) as Record<string, unknown>
  const raw = String(i.command ?? i.file_path ?? i.url ?? i.description ?? '')
  return raw.length > 100 ? `${raw.slice(0, 99)}…` : raw
}

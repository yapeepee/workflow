import type { EngineInterface, Register } from 'claude-code'

import { describe, prose, scan } from './terms'

// Files: the finding rides back on the tool's result, so Claude fixes the file
// in its next step. Replies: a toast for you, and at most every third turn a
// note Claude reads next turn (meta, so you do not see it in the transcript).

type Config = { skip: RegExp | undefined; remindModel: boolean }

const REMIND_EVERY = 3
const turns = { sinceReminder: REMIND_EVERY }

export const register: Register = (on, options) => {
  const cfg: Config = { skip: compile(String(options.skipPaths ?? 'zh[-_]?(cn|hans|sg)')), remindModel: options.remindModel !== false }

  on('tool.call', { tool: 'Write' }, async ($, e, next) => {
    const ran = await next(e)
    return ran.deny === undefined && ran.isError !== true ? withNote($, cfg, ran, e.file_path, e.content) : ran
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: 'Edit' }, async ($, e, next) => {
    const ran = await next(e)
    return ran.deny === undefined && ran.isError !== true ? withNote($, cfg, ran, e.file_path, e.new_string) : ran
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: 'NotebookEdit' }, async ($, e, next) => {
    const ran = await next(e)
    return ran.deny === undefined && ran.isError !== true ? withNote($, cfg, ran, e.notebook_path, e.new_source) : ran
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (e.agentId !== undefined || e.isAborted) return done
    turns.sinceReminder += 1
    const found = scan(prose(e.answer))
    if (found.length === 0) return done
    $.ui.toast(`繁中檢查：上一則回覆有 ${describe(found)}`)
    if (cfg.remindModel && turns.sinceReminder >= REMIND_EVERY) {
      turns.sinceReminder = 0
      const text = `（zhtw-check）你上一則回覆用了簡體字或中國用語：${describe(found)}。之後請用台灣繁體中文和台灣的技術用語。`
      await $.session.append({ message: { type: 'user', content: [{ type: 'text', text }] } }).catch(() => undefined)
    }
    return done
  })
}

async function withNote<R extends { context?: readonly string[] }>($: EngineInterface, cfg: Config, ran: R, path: string, text: string) {
  if (cfg.skip?.test(path)) return ran
  const found = scan(text)
  if (found.length === 0) return ran
  const name = path.slice(path.lastIndexOf('/') + 1)
  $.ui.toast(`繁中檢查：${name} 有 ${describe(found, 3)}`)
  const note = `zhtw-check：剛寫入 ${path} 的內容有簡體字或中國用語：${describe(found)}。這個專案用台灣繁體中文，請修正這個檔案（引用的原文、程式識別字和簡體語系檔不用改）。`
  return { ...ran, context: [...(ran.context ?? []), note] }
}

function compile(source: string) {
  try {
    return source.trim() === '' ? undefined : new RegExp(source, 'i')
  } catch {
    return undefined
  }
}

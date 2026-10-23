import { describe as group, expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { prose, scan } from './terms'

function world(on: On) {
  const toasts: string[] = []
  on('ui.toast', (_$, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('tool.call', () => ({ result: {} }))
  on('turn.complete', (_$, e) => ({ text: e.answer }))
  return { toasts, session: mock.session(on) }
}

const reply = (answer: string) => ({ turnId: 't', answer, durationMs: 1000, isAborted: false, reason: 'answer' as const })

group('scan', () => {
  test('simplified text gets its Taiwan words, longest first', () => {
    const found = scan('这个数据库的默认值')
    expect(found.map(f => `${f.from}→${f.to}`)).toEqual(['数据库→資料庫', '默认→預設', '这个→對應的繁體字'])
  })

  test('mainland words written in Traditional script are caught too', () => {
    const found = scan('請在網絡設置裡調用接口')
    expect(found.map(f => f.from).sort()).toEqual(['接口', '網絡', '設置', '調用'].sort())
  })

  test('Taiwan usage that only looks similar is left alone', () => {
    expect(scan('這個預設值存在資料庫；大數據分析；錯誤代碼；處理程序；系統優化；項目清單；內容')).toEqual([])
  })

  test('look-alike code points are told apart: 内 is flagged, 內 is not', () => {
    expect(scan('內容')).toEqual([])
    expect(scan('内容')[0]?.from).toBe('内')
  })

  test('code in a reply is not prose', () => {
    expect(scan(prose('改好了：`const 数据 = 1`\n```\n默认\n```\n完成'))).toEqual([])
  })
})

group('files', () => {
  test('a write with simplified text comes back with a note for Claude and a toast for you', async ($, on) => {
    const w = world(on)
    const r = await $.tool.call({ tool: 'Write', file_path: '/r/Docs/guide.md', content: '# 用户导入\n设置默认密码' })
    expect(r.context?.[0]).toContain('zhtw-check：剛寫入 /r/Docs/guide.md')
    expect(r.context?.[0]).toContain('用户→使用者')
    expect(w.toasts[0]).toContain('繁中檢查：guide.md 有')
  })

  test('clean Taiwan text and a zh-CN resource file pass untouched', async ($, on) => {
    const w = world(on)
    const clean = await $.tool.call({ tool: 'Edit', file_path: '/r/a.cs', old_string: 'x', new_string: '// 匯入使用者，預設密碼' })
    const cn = await $.tool.call({ tool: 'Write', file_path: '/r/i18n/zh-CN.json', content: '{"save": "保存数据"}' })
    expect(clean.context).toBeUndefined()
    expect(cn.context).toBeUndefined()
    expect(w.toasts).toEqual([])
  })
})

group('replies', () => {
  test('a reply in simplified text is toasted, and Claude is reminded at most every third turn', async ($, on) => {
    const w = world(on)
    await $.turn.complete(reply('我已经修好了这个问题'))
    await $.turn.complete(reply('数据已经更新'))
    expect(w.toasts).toHaveLength(2)
    const notes = w.session.appended().map(r => JSON.stringify(r.message.content))
    expect(notes).toHaveLength(1)
    expect(notes[0]).toContain('zhtw-check')
  })

  test('a Traditional reply in Taiwan wording stays quiet', async ($, on) => {
    const w = world(on)
    await $.turn.complete(reply('已經修好，測試全部通過。'))
    expect(w.toasts).toEqual([])
    expect(w.session.appended()).toEqual([])
  })
})

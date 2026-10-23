export type ChangeRow = {
  path: string
  code: string
  added: number | null
  deleted: number | null
  touched: boolean
}

export type ChangeDiff = { path: string; source: string; isTruncated: boolean }

declare module 'claude-code' {
  interface PluginState {
    'session-changes': {
      rows: ChangeRow[]
      branch: string
      diff: ChangeDiff | null
      onlyTouched: boolean
      notice: string | null
    }
  }
}

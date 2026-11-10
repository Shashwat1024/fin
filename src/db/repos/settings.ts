import type { SettingsPatch } from '@shared/schemas'
import { DEFAULT_SETTINGS, type Settings } from '@shared/types'
import { all, run, transaction, type Db } from '../connection'

export function getSettings(db: Db): Settings {
  const rows = all<{ key: string; value: string }>(db, 'SELECT key, value FROM settings')
  const out: Record<string, unknown> = { ...DEFAULT_SETTINGS }
  for (const r of rows) {
    if (r.key in DEFAULT_SETTINGS) {
      try {
        out[r.key] = JSON.parse(r.value)
      } catch {
        // Ignore a corrupt value and keep the default.
      }
    }
  }
  return out as Settings
}

export function updateSettings(db: Db, patch: SettingsPatch): Settings {
  transaction(db, () => {
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined || !(key in DEFAULT_SETTINGS)) continue
      run(
        db,
        'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value',
        key,
        JSON.stringify(value),
      )
    }
  })
  return getSettings(db)
}

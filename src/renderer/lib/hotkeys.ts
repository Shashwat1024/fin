import { useEffect, useRef } from 'react'

/** Parse "mod+shift+k": `mod` is Ctrl on Windows/Linux and ⌘ on macOS. */
function matches(e: KeyboardEvent, combo: string): boolean {
  const parts = combo.toLowerCase().split('+')
  const key = parts.pop()
  const want = new Set(parts)
  const mod = e.ctrlKey || e.metaKey
  if (want.has('mod') !== mod) return false
  if (want.has('shift') !== e.shiftKey) return false
  if (want.has('alt') !== e.altKey) return false
  return e.key.toLowerCase() === key
}

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
}

/**
 * Register a global keyboard shortcut. Shortcuts with a modifier work everywhere; plain keys are
 * ignored while the user is typing in a field.
 */
export function useHotkey(combo: string, handler: (e: KeyboardEvent) => void, enabled = true) {
  const ref = useRef(handler)
  useEffect(() => {
    ref.current = handler
  })
  useEffect(() => {
    if (!enabled) return
    const hasModifier = /mod|alt/.test(combo)
    const onKey = (e: KeyboardEvent) => {
      if (!matches(e, combo)) return
      if (!hasModifier && isTyping(e.target)) return
      e.preventDefault()
      ref.current(e)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [combo, enabled])
}

export const SHORTCUTS = [
  { combo: 'mod+k', label: 'Command palette' },
  { combo: 'shift+?', label: 'Keyboard shortcuts' },
  { combo: 'mod+n', label: 'Add expense' },
  { combo: 'mod+i', label: 'Add income' },
  { combo: 'mod+t', label: 'Add transfer' },
  { combo: 'mod+1', label: 'Go to Overview' },
  { combo: 'mod+2', label: 'Go to Transactions' },
  { combo: 'mod+3', label: 'Go to Accounts' },
  { combo: 'mod+4', label: 'Go to Import' },
  { combo: 'mod+5', label: 'Go to Recurring' },
  { combo: 'mod+6', label: 'Go to Budget' },
  { combo: 'mod+7', label: 'Go to Goals' },
  { combo: 'mod+8', label: 'Go to Categories & rules' },
  { combo: 'mod+9', label: 'Go to Forecast' },
  { combo: 'mod+0', label: 'Go to Net worth' },
  { combo: 'mod+,', label: 'Go to Settings' },
  { combo: 'mod+l', label: 'Lock Fin (when a PIN is set)' },
] as const

export type ShortcutGroup = { title: string; items: { combos: string[]; label: string }[] }

/** Every shortcut, grouped by where it works (T105). Keys handled inside a page are listed here too. */
export const SHORTCUT_GROUPS: ShortcutGroup[] = [
  { title: 'Anywhere', items: SHORTCUTS.map((s) => ({ combos: [s.combo], label: s.label })) },
  {
    title: 'Transaction list',
    items: [
      { combos: ['arrowup', 'arrowdown'], label: 'Move between rows' },
      { combos: ['pageup', 'pagedown'], label: 'Move 10 rows' },
      { combos: ['home', 'end'], label: 'First or last row' },
      { combos: ['enter'], label: 'Open the transaction' },
      { combos: ['space'], label: 'Select or unselect' },
      { combos: ['delete'], label: 'Delete selected (can be undone)' },
      { combos: ['escape'], label: 'Clear the selection' },
    ],
  },
  {
    title: 'Forms and dialogs',
    items: [
      { combos: ['mod+enter'], label: 'Save the transaction' },
      { combos: ['escape'], label: 'Close without saving' },
      { combos: ['tab', 'shift+tab'], label: 'Next or previous field' },
    ],
  },
  {
    title: 'Budget',
    items: [
      { combos: ['alt+arrowleft', 'alt+arrowright'], label: 'Previous or next month' },
      { combos: ['enter', 'shift+enter'], label: 'Save and go to the next or previous row' },
      { combos: ['arrowup', 'arrowdown'], label: 'Move between categories' },
      { combos: ['escape'], label: 'Undo the edit in the box' },
    ],
  },
  {
    title: 'Charts',
    items: [
      { combos: ['arrowleft', 'arrowright'], label: 'Previous or next point' },
      { combos: ['pageup', 'pagedown'], label: 'A week back or forward' },
      { combos: ['home', 'end'], label: 'First or last point' },
    ],
  },
]

/** Ask the shortcuts sheet to open (from the command palette or a button). */
export const SHOW_SHORTCUTS_EVENT = 'fin:show-shortcuts'
export const showShortcuts = () => window.dispatchEvent(new Event(SHOW_SHORTCUTS_EVENT))

const KEY_NAMES: Record<string, string> = {
  mod: 'Ctrl',
  arrowup: '↑',
  arrowdown: '↓',
  arrowleft: '←',
  arrowright: '→',
  escape: 'Esc',
  pageup: 'PgUp',
  pagedown: 'PgDn',
  delete: 'Del',
}

export function comboLabel(combo: string): string[] {
  return combo
    .split('+')
    .map((k) => KEY_NAMES[k] ?? (k.length === 1 ? k.toUpperCase() : k[0]!.toUpperCase() + k.slice(1)))
}

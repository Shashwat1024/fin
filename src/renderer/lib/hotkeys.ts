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
  { combo: 'mod+n', label: 'Add expense' },
  { combo: 'mod+i', label: 'Add income' },
  { combo: 'mod+t', label: 'Add transfer' },
  { combo: 'mod+1', label: 'Go to Overview' },
  { combo: 'mod+2', label: 'Go to Transactions' },
  { combo: 'mod+3', label: 'Go to Accounts' },
  { combo: 'mod+4', label: 'Go to Import' },
  { combo: 'mod+,', label: 'Go to Settings' },
] as const

export function comboLabel(combo: string): string[] {
  return combo.split('+').map((k) => (k === 'mod' ? 'Ctrl' : k.length === 1 ? k.toUpperCase() : k[0]!.toUpperCase() + k.slice(1)))
}

import { useState } from 'react'

/**
 * Give focus back to whatever had it when a dialog opened (WCAG 2.4.3). Radix only does this for a
 * dialog's own Trigger; most of Fin's dialogs open from shortcuts, menus or other buttons.
 * Call during the dialog content's first render, before it moves focus inside.
 */
export function useReturnFocus() {
  const [opener] = useState(() => (typeof document === 'undefined' ? null : (document.activeElement as HTMLElement | null)))
  return (e: Event) => {
    if (e.defaultPrevented || !opener || opener === document.body || !opener.isConnected) return
    e.preventDefault()
    opener.focus()
  }
}

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Theme } from '@shared/types'
import { useSettings } from './queries'

type Resolved = 'light' | 'dark'
const ThemeContext = createContext<{ theme: Theme; resolved: Resolved }>({ theme: 'system', resolved: 'light' })

function systemTheme(): Resolved {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

/** Applies the user's theme preference (light / dark / follow the system) to the document. */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const { data } = useSettings()
  const theme = data?.theme ?? 'system'
  const [system, setSystem] = useState<Resolved>(systemTheme)
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => setSystem(mq.matches ? 'dark' : 'light')
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  const resolved = theme === 'system' ? system : theme
  useEffect(() => {
    document.documentElement.classList.toggle('dark', resolved === 'dark')
    document.documentElement.style.colorScheme = resolved
  }, [resolved])
  return <ThemeContext.Provider value={{ theme, resolved }}>{children}</ThemeContext.Provider>
}

export const useTheme = () => useContext(ThemeContext)

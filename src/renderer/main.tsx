import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from '@renderer/components/ui/sonner'
import { TooltipProvider } from '@renderer/components/ui/tooltip'
import { LockGate } from '@renderer/features/lock/LockGate'
import { refreshLock } from '@renderer/features/lock/lock'
import { installTauriBridge } from '@renderer/lib/bridge'
import { IpcCallError } from '@renderer/lib/ipc'
import { ThemeProvider } from '@renderer/lib/theme'
import { App } from './App'
import './styles/globals.css'

installTauriBridge()

// A request refused because Fin is locked (by the tray, or while idle) shows the lock screen.
const onError = (err: unknown) => {
  if (err instanceof IpcCallError && err.code === 'LOCKED')
    void refreshLock(queryClient).catch(() => undefined)
}

// Data is local; queries are invalidated explicitly after every change.
const queryClient: QueryClient = new QueryClient({
  queryCache: new QueryCache({ onError }),
  mutationCache: new MutationCache({ onError }),
  defaultOptions: {
    queries: { staleTime: 60_000, refetchOnWindowFocus: false, retry: false },
    mutations: { retry: false },
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <TooltipProvider>
          <LockGate>
            <App />
          </LockGate>
          <Toaster position="bottom-right" closeButton />
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  </StrictMode>,
)

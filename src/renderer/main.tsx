import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from '@renderer/components/ui/sonner'
import { TooltipProvider } from '@renderer/components/ui/tooltip'
import { ThemeProvider } from '@renderer/lib/theme'
import { App } from './App'
import './styles/globals.css'

// Data is local; queries are invalidated explicitly after every change.
const queryClient = new QueryClient({
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
          <App />
          <Toaster position="bottom-right" closeButton />
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  </StrictMode>,
)

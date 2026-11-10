import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

/**
 * The interface on its own, for the Tauri shell. Tauri sets the Content-Security-Policy itself
 * (src-tauri/tauri.conf.json), so the Electron CSP placeholder is simply dropped here.
 */
export default defineConfig({
  root: resolve('src/renderer'),
  base: './',
  resolve: {
    alias: {
      '@domain': resolve('src/domain'),
      '@shared': resolve('src/shared'),
      '@renderer': resolve('src/renderer'),
    },
  },
  plugins: [
    react(),
    tailwindcss(),
    { name: 'fin-no-csp-meta', transformIndexHtml: (html) => html.replace('<!--fin:csp-->', '') },
  ],
  server: { port: 5173, strictPort: true },
  build: { outDir: resolve('out/tauri-renderer'), emptyOutDir: true, target: 'es2023' },
})

import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import type { Plugin } from 'vite'

/** Strict Content-Security-Policy for production builds (dev needs inline scripts for HMR). */
function csp(): Plugin {
  const policy = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ')
  return {
    name: 'fin-csp',
    transformIndexHtml(html, ctx) {
      const tag = ctx.server ? '' : `<meta http-equiv="Content-Security-Policy" content="${policy}" />`
      return html.replace('<!--fin:csp-->', tag)
    },
  }
}

const alias = {
  '@domain': resolve('src/domain'),
  '@shared': resolve('src/shared'),
  '@db': resolve('src/db'),
}

export default defineConfig({
  main: {
    resolve: { alias },
    build: { rollupOptions: { input: resolve('src/main/index.ts') } },
  },
  preload: {
    build: {
      rollupOptions: {
        input: resolve('src/preload/index.ts'),
        // Sandboxed preload scripts must be CommonJS.
        output: { format: 'cjs', entryFileNames: '[name].cjs' },
      },
    },
  },
  renderer: {
    root: resolve('src/renderer'),
    resolve: { alias: { ...alias, '@renderer': resolve('src/renderer') } },
    plugins: [react(), tailwindcss(), csp()],
    build: { rollupOptions: { input: resolve('src/renderer/index.html') } },
  },
})

import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

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
    plugins: [react(), tailwindcss()],
    build: { rollupOptions: { input: resolve('src/renderer/index.html') } },
  },
})

// Runs Vitest from the project folder's real name. On Windows a folder opened as `c:\…` rather than
// `C:\…` (as VS Code can) otherwise loads Vitest twice under two spellings of the same path, and
// every suite fails with "failed to find the current suite".
import { realpathSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const root = realpathSync.native(process.cwd())
process.chdir(root)
await import(pathToFileURL(join(root, 'node_modules', 'vitest', 'vitest.mjs')).href)

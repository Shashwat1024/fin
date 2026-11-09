// Runs electron-vite with ELECTRON_RUN_AS_NODE removed. Editors built on Electron (VS Code) set it
// for child processes, which would make Electron start as plain Node and exit immediately.
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

const require = createRequire(import.meta.url)
// The bin file is not in the package's "exports", so resolve it next to package.json.
const pkgJson = require.resolve('electron-vite/package.json')
const cli = join(dirname(pkgJson), require(pkgJson).bin['electron-vite'])
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE

const child = spawn(process.execPath, [cli, ...process.argv.slice(2)], { stdio: 'inherit', env })
child.on('exit', (code, signal) => process.exit(signal ? 1 : (code ?? 0)))

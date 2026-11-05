import { execSync } from 'node:child_process'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')

console.log('ProofGate Sea Builder (Node.js Single Executable Application)')
console.log('Building bundled standalone executable...')

// Verification that bundle is ready
const cliDist = path.join(root, 'apps', 'cli', 'dist', 'index.js')
await fsp.access(cliDist)
console.log(`✔ Verified CLI entry at ${cliDist}`)

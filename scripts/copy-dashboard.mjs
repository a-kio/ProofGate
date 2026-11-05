import fsp from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')

const source = path.join(root, 'apps', 'dashboard', 'dist')
const target = path.join(root, 'apps', 'cli', 'dist', 'ui')

async function copyDir(src, dest) {
  await fsp.mkdir(dest, { recursive: true })
  const entries = await fsp.readdir(src, { withFileTypes: true })
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name)
    const destPath = path.join(dest, entry.name)
    if (entry.isDirectory()) {
      await copyDir(srcPath, destPath)
    } else {
      await fsp.copyFile(srcPath, destPath)
    }
  }
}

try {
  await copyDir(source, target)
  console.log(`✔ Copied dashboard dist to ${target}`)
} catch (e) {
  console.error(`Failed to copy dashboard: ${e.message}`)
  process.exit(1)
}

import { execSync } from 'node:child_process'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const cliEntry = path.join(root, 'apps', 'cli', 'dist', 'index.js')

async function run() {
  console.log('Testing ProofGate CLI smoke test...')
  const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'proofgate-smoke-'))

  try {
    console.log(`1. Initializing in temporary workspace: ${tmpDir}`)
    await fsp.writeFile(path.join(tmpDir, 'index.js'), 'console.log("hello proofgate");\n', 'utf8')
    execSync(`node "${cliEntry}" init "${tmpDir}"`, { stdio: 'inherit' })

    console.log('2. Inspecting plan...')
    execSync(`node "${cliEntry}" plan "${tmpDir}"`, { stdio: 'inherit' })

    console.log('3. Running verify (--full)...')
    execSync(`node "${cliEntry}" verify "${tmpDir}" --full`, { stdio: 'inherit' })

    console.log('4. Checking status...')
    execSync(`node "${cliEntry}" status "${tmpDir}"`, { stdio: 'inherit' })

    console.log('5. Listing runs...')
    execSync(`node "${cliEntry}" list "${tmpDir}"`, { stdio: 'inherit' })

    console.log('\n✔ All smoke tests passed successfully!')
  } finally {
    await fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => {})
  }
}

run().catch((e) => {
  console.error('Smoke test failed:', e)
  process.exit(1)
})

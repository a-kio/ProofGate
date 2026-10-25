import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { getToolVersion, resolveCommand } from '@proofgate/executor'
import { HIDDEN_DIRS, toPosix } from '@proofgate/shared'
import { getGitInfo } from './git.js'
import type { DetectedProject, EcosystemInfo, ToolInfo } from './types.js'

async function listRootFiles(root: string): Promise<string[]> {
  try {
    const entries = await fsp.readdir(root, { withFileTypes: true })
    return entries
      .filter((entry) => entry.isFile())
      .map((entry) => toPosix(entry.name))
      .filter((name) => !HIDDEN_DIRS.has(name))
      .sort()
  } catch {
    return []
  }
}

interface PackageJson {
  name?: string
  scripts?: Record<string, string>
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  workspaces?: string[] | { packages?: string[] }
  packageManager?: string
}

async function readPackageJson(root: string): Promise<PackageJson | null> {
  const file = path.join(root, 'package.json')
  try {
    const stat = await fsp.stat(file)
    if (stat.size > 2 * 1024 * 1024) return null
    const raw: unknown = JSON.parse(await fsp.readFile(file, 'utf8'))
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
    return raw as PackageJson
  } catch {
    return null
  }
}

const NODE_TOOLS: Array<{ id: string; name: string; kind: ToolInfo['kind']; deps: string[]; configs: string[] }> = [
  { id: 'typescript', name: 'TypeScript', kind: 'build', deps: ['typescript'], configs: ['tsconfig.json'] },
  { id: 'eslint', name: 'ESLint', kind: 'lint', deps: ['eslint'], configs: ['eslint.config.js', 'eslint.config.mjs', 'eslint.config.cjs', '.eslintrc', '.eslintrc.json', '.eslintrc.js'] },
  { id: 'biome', name: 'Biome', kind: 'lint', deps: ['@biomejs/biome'], configs: ['biome.json', 'biome.jsonc'] },
  { id: 'prettier', name: 'Prettier', kind: 'format', deps: ['prettier'], configs: ['.prettierrc', '.prettierrc.json', 'prettier.config.js'] },
  { id: 'vitest', name: 'Vitest', kind: 'test', deps: ['vitest'], configs: ['vitest.config.ts', 'vitest.config.js', 'vitest.config.mts'] },
  { id: 'jest', name: 'Jest', kind: 'test', deps: ['jest'], configs: ['jest.config.js', 'jest.config.ts', 'jest.config.cjs'] },
  { id: 'playwright', name: 'Playwright', kind: 'test', deps: ['@playwright/test', 'playwright'], configs: ['playwright.config.ts', 'playwright.config.js'] },
  { id: 'cypress', name: 'Cypress', kind: 'test', deps: ['cypress'], configs: ['cypress.config.ts', 'cypress.config.js'] },
  { id: 'vite', name: 'Vite', kind: 'build', deps: ['vite'], configs: ['vite.config.ts', 'vite.config.js'] },
  { id: 'next', name: 'Next.js', kind: 'build', deps: ['next'], configs: ['next.config.js', 'next.config.mjs', 'next.config.ts'] },
  { id: 'tailwind', name: 'Tailwind CSS', kind: 'build', deps: ['tailwindcss'], configs: ['tailwind.config.js', 'tailwind.config.ts'] },
  { id: 'tsup', name: 'tsup', kind: 'build', deps: ['tsup'], configs: ['tsup.config.ts'] },
]

async function detectNodeTools(files: string[], pkg: PackageJson): Promise<ToolInfo[]> {
  const deps = new Set([
    ...Object.keys(pkg.dependencies ?? {}),
    ...Object.keys(pkg.devDependencies ?? {}),
    ...Object.keys(pkg.peerDependencies ?? {}),
  ])
  const tools: ToolInfo[] = []
  for (const candidate of NODE_TOOLS) {
    const configFiles = candidate.configs.filter((name) => files.includes(name))
    const depPresent = candidate.deps.some((dep) => deps.has(dep))
    if (configFiles.length > 0 || depPresent) {
      tools.push({
        id: candidate.id,
        name: candidate.name,
        kind: candidate.kind,
        configFiles,
      })
    }
  }
  return tools
}

async function detectPackageManager(
  files: string[],
  pkg: PackageJson | null,
): Promise<DetectedProject['packageManager']> {
  const declared = pkg?.packageManager?.split('@')[0]
  if (declared === 'pnpm' || declared === 'npm' || declared === 'yarn' || declared === 'bun' || declared === 'deno') {
    return declared
  }
  if (files.includes('pnpm-lock.yaml') || files.includes('pnpm-workspace.yaml')) return 'pnpm'
  if (files.includes('yarn.lock')) return 'yarn'
  if (files.includes('bun.lockb') || files.includes('bun.lock')) return 'bun'
  if (files.includes('package-lock.json') || files.includes('npm-shrinkwrap.json')) return 'npm'
  if (files.includes('deno.json') || files.includes('deno.jsonc')) return 'deno'
  if (pkg) return 'npm'
  return undefined
}

async function detectWorkspaces(root: string, files: string[], pkg: PackageJson | null): Promise<string[]> {
  if (files.includes('pnpm-workspace.yaml')) {
    try {
      const text = await fsp.readFile(path.join(root, 'pnpm-workspace.yaml'), 'utf8')
      const patterns: string[] = []
      let inPackages = false
      for (const line of text.split(/\r?\n/)) {
        if (/^\s*packages\s*:/.test(line)) {
          inPackages = true
          continue
        }
        if (inPackages) {
          const match = /^\s*-\s*['"]?([^'"]+?)['"]?\s*$/.exec(line)
          if (match?.[1]) patterns.push(match[1])
          else if (/^\S/.test(line)) break
        }
      }
      return patterns
    } catch {
      return []
    }
  }
  if (Array.isArray(pkg?.workspaces)) return pkg.workspaces
  if (pkg?.workspaces && typeof pkg.workspaces === 'object' && Array.isArray(pkg.workspaces.packages)) {
    return pkg.workspaces.packages
  }
  return []
}

async function detectOtherEcosystems(root: string, files: string[]): Promise<EcosystemInfo[]> {
  const ecosystems: EcosystemInfo[] = []
  const checks: Array<{ id: EcosystemInfo['id']; files: string[]; confidence: EcosystemInfo['confidence']; evidence?: string[] }> = [
    { id: 'python', files: ['pyproject.toml', 'requirements.txt', 'setup.py', 'setup.cfg', 'Pipfile', 'poetry.lock'], confidence: 'high' },
    { id: 'rust', files: ['Cargo.toml', 'Cargo.lock', 'rust-toolchain.toml'], confidence: 'high' },
    { id: 'go', files: ['go.mod', 'go.sum', 'go.work'], confidence: 'high' },
    { id: 'java', files: ['pom.xml', 'build.gradle', 'build.gradle.kts', 'settings.gradle', 'settings.gradle.kts'], confidence: 'high' },
    { id: 'dotnet', files: ['global.json', 'Directory.Build.props'], confidence: 'medium' },
    { id: 'ruby', files: ['Gemfile', 'Gemfile.lock', 'Rakefile'], confidence: 'high' },
    { id: 'php', files: ['composer.json', 'composer.lock'], confidence: 'high' },
  ]
  for (const candidate of checks) {
    const evidence = candidate.files.filter((file) => files.includes(file))
    if (evidence.length > 0) ecosystems.push({ id: candidate.id, evidence, confidence: candidate.confidence })
  }
  // Glob for .sln / .csproj at the root only.
  try {
    const entries = await fsp.readdir(root)
    const dotnet = entries.filter((name) => name.endsWith('.sln') || name.endsWith('.csproj'))
    if (dotnet.length > 0) {
      const existing = ecosystems.find((ecosystem) => ecosystem.id === 'dotnet')
      if (existing) existing.evidence.push(...dotnet)
      else ecosystems.push({ id: 'dotnet', evidence: dotnet, confidence: 'high' })
    }
  } catch {
    // ignore
  }
  return ecosystems
}

async function detectAuxTools(root: string, files: string[], ecosystems: EcosystemInfo[]): Promise<ToolInfo[]> {
  const tools: ToolInfo[] = []
  const has = (name: string): boolean => files.includes(name)
  if (has('Dockerfile') || has('compose.yaml') || has('docker-compose.yml')) {
    tools.push({
      id: 'docker',
      name: 'Docker',
      kind: 'container',
      configFiles: ['Dockerfile', 'compose.yaml', 'docker-compose.yml'].filter(has),
    })
  }
  if (has('.github')) {
    try {
      const stat = fs.statSync(path.join(root, '.github'))
      if (stat.isDirectory()) tools.push({ id: 'github-actions', name: 'GitHub Actions', kind: 'ci', configFiles: ['.github'] })
    } catch {
      // ignore
    }
  }
  if (has('Makefile') || has('makefile')) tools.push({ id: 'make', name: 'Make', kind: 'build', configFiles: ['Makefile'] })
  if (has('turbo.json')) tools.push({ id: 'turborepo', name: 'Turborepo', kind: 'build', configFiles: ['turbo.json'] })
  if (has('nx.json')) tools.push({ id: 'nx', name: 'Nx', kind: 'build', configFiles: ['nx.json'] })
  if (has('lerna.json')) tools.push({ id: 'lerna', name: 'Lerna', kind: 'build', configFiles: ['lerna.json'] })

  if (ecosystems.some((ecosystem) => ecosystem.id === 'python')) {
    if (has('pytest.ini') || has('conftest.py') || has('tox.ini')) {
      tools.push({ id: 'pytest', name: 'pytest', kind: 'test', configFiles: ['pytest.ini', 'conftest.py', 'tox.ini'].filter(has) })
    }
    if (has('ruff.toml') || has('.ruff.toml')) {
      tools.push({ id: 'ruff', name: 'Ruff', kind: 'lint', configFiles: ['ruff.toml', '.ruff.toml'].filter(has) })
    }
    if (has('mypy.ini') || has('.mypy.ini')) {
      tools.push({ id: 'mypy', name: 'mypy', kind: 'lint', configFiles: ['mypy.ini', '.mypy.ini'].filter(has) })
    }
  }
  return tools
}

export async function detectProject(rootInput: string): Promise<DetectedProject> {
  const root = path.resolve(rootInput)
  const files = await listRootFiles(root)
  const pkg = await readPackageJson(root)
  const git = await getGitInfo(root)
  const ecosystems: EcosystemInfo[] = []
  if (pkg) {
    ecosystems.push({
      id: 'node',
      confidence: 'high',
      evidence: ['package.json', ...files.filter((file) => /^(?:pnpm-lock\.yaml|package-lock\.json|yarn\.lock|bun\.lockb?)$/.test(file))],
    })
  }
  ecosystems.push(...(await detectOtherEcosystems(root, files)))
  if (ecosystems.length === 0) ecosystems.push({ id: 'unknown', confidence: 'low', evidence: [] })

  const tools: ToolInfo[] = []
  if (pkg) tools.push(...(await detectNodeTools(files, pkg)))
  tools.push(...(await detectAuxTools(root, files, ecosystems)))

  const packageManager = await detectPackageManager(files, pkg)
  const packageManagerVersion = packageManager ? ((await getToolVersion(packageManager, { cwd: root })) ?? undefined) : undefined
  const workspaces = await detectWorkspaces(root, files, pkg)
  const monorepo = workspaces.length > 0 || files.includes('pnpm-workspace.yaml') || files.includes('turbo.json') || files.includes('nx.json')

  const scripts: Record<string, string> = {}
  for (const [name, command] of Object.entries(pkg?.scripts ?? {})) {
    if (typeof command === 'string') scripts[name] = command
  }

  return {
    root,
    name: pkg?.name ?? path.basename(root),
    ecosystems,
    ...(packageManager ? { packageManager } : {}),
    ...(packageManagerVersion ? { packageManagerVersion } : {}),
    scripts,
    tools,
    monorepo,
    workspaces,
    git,
    installedDependencies: fs.existsSync(path.join(root, 'node_modules')),
    files,
  }
}

export function hasExecutable(command: string, cwd?: string): boolean {
  return resolveCommand(command, { cwd }) !== null
}

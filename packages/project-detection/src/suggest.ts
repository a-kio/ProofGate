import { resolveCommand } from '@proofgate/executor'
import type { DetectedProject, SuggestedCheck } from './types.js'

type PackageManager = NonNullable<DetectedProject['packageManager']>

function runScript(pm: PackageManager, script: string): string[] {
  switch (pm) {
    case 'pnpm':
      return ['pnpm', 'run', script]
    case 'yarn':
      return ['yarn', 'run', script]
    case 'bun':
      return ['bun', 'run', script]
    case 'deno':
      return ['deno', 'task', script]
    default:
      return ['npm', 'run', script]
  }
}

function execLocal(pm: PackageManager, binary: string, args: string[]): string[] {
  switch (pm) {
    case 'pnpm':
      return ['pnpm', 'exec', binary, ...args]
    case 'yarn':
      return ['yarn', 'run', binary, ...args]
    case 'bun':
      return ['bunx', binary, ...args]
    case 'deno':
      return ['deno', 'run', 'npm:' + binary, ...args]
    default:
      return ['npm', 'exec', '--', binary, ...args]
  }
}

const SOURCE_GLOBS = ['**/*.{ts,tsx,js,jsx,mjs,cjs,mts,cts,json,vue,svelte,astro}']
const TEST_GLOBS = ['**/*.{ts,tsx,js,jsx,mjs,cjs,py,rs,go,java,cs,rb,php}']
const LINT_GLOBS = ['**/*.{ts,tsx,js,jsx,mjs,cjs,mts,cts,json,css,scss,md,vue,svelte,astro}']

function tool(project: DetectedProject, id: string): boolean {
  return project.tools.some((entry) => entry.id === id)
}

function withSecretScan(checks: SuggestedCheck[]): SuggestedCheck[] {
  checks.push({
    id: 'secret-scan',
    title: 'No committed secrets in changed files',
    type: 'secret-scan',
    paths: ['**/*'],
    required: true,
    profiles: ['fast', 'balanced', 'thorough'],
    timeoutSeconds: 120,
  })
  return checks
}

function suggestNode(project: DetectedProject): SuggestedCheck[] {
  const checks: SuggestedCheck[] = []
  const pm = project.packageManager ?? 'npm'
  const hasScript = (name: string): boolean => typeof project.scripts[name] === 'string'

  if (hasScript('typecheck')) {
    checks.push({
      id: 'typecheck',
      title: 'TypeScript typecheck',
      type: 'command',
      run: runScript(pm, 'typecheck'),
      required: true,
      profiles: ['fast', 'balanced', 'thorough'],
      timeoutSeconds: 900,
      appliesTo: SOURCE_GLOBS,
      description: 'Runs the project typecheck script.',
    })
  } else if (tool(project, 'typescript')) {
    checks.push({
      id: 'typecheck',
      title: 'TypeScript typecheck (tsc --noEmit)',
      type: 'command',
      run: execLocal(pm, 'tsc', ['--noEmit']),
      required: true,
      profiles: ['fast', 'balanced', 'thorough'],
      timeoutSeconds: 900,
      appliesTo: SOURCE_GLOBS,
      description: 'Detected tsconfig.json without a typecheck script; runs tsc directly.',
    })
  }

  if (hasScript('lint')) {
    checks.push({
      id: 'lint',
      title: 'Lint',
      type: 'command',
      run: runScript(pm, 'lint'),
      required: true,
      profiles: ['fast', 'balanced', 'thorough'],
      timeoutSeconds: 900,
      appliesTo: LINT_GLOBS,
      description: 'Runs the project lint script.',
    })
  } else if (tool(project, 'biome')) {
    checks.push({
      id: 'lint',
      title: 'Biome check',
      type: 'command',
      run: execLocal(pm, 'biome', ['check', '.']),
      required: true,
      profiles: ['fast', 'balanced', 'thorough'],
      timeoutSeconds: 600,
      appliesTo: LINT_GLOBS,
      description: 'Detected biome.json without a lint script.',
    })
  } else if (tool(project, 'eslint')) {
    checks.push({
      id: 'lint',
      title: 'ESLint',
      type: 'command',
      run: execLocal(pm, 'eslint', ['.']),
      required: true,
      profiles: ['fast', 'balanced', 'thorough'],
      timeoutSeconds: 600,
      appliesTo: LINT_GLOBS,
      description: 'Detected an ESLint config without a lint script.',
    })
  }

  if (hasScript('test')) {
    checks.push({
      id: 'test',
      title: 'Test suite',
      type: 'command',
      run: runScript(pm, 'test'),
      env: { CI: '1' },
      required: true,
      profiles: ['fast', 'balanced', 'thorough'],
      timeoutSeconds: 1800,
      appliesTo: TEST_GLOBS,
      description: 'Runs the project test script with CI=1 so runners do not enter watch mode.',
    })
  } else if (tool(project, 'vitest')) {
    checks.push({
      id: 'test',
      title: 'Vitest',
      type: 'command',
      run: execLocal(pm, 'vitest', ['run']),
      env: { CI: '1' },
      required: true,
      profiles: ['fast', 'balanced', 'thorough'],
      timeoutSeconds: 1800,
      appliesTo: TEST_GLOBS,
      description: 'Detected Vitest without a test script.',
    })
  } else if (tool(project, 'jest')) {
    checks.push({
      id: 'test',
      title: 'Jest',
      type: 'command',
      run: execLocal(pm, 'jest', ['--ci']),
      env: { CI: '1' },
      required: true,
      profiles: ['fast', 'balanced', 'thorough'],
      timeoutSeconds: 1800,
      appliesTo: TEST_GLOBS,
      description: 'Detected Jest without a test script.',
    })
  }

  if (hasScript('build')) {
    checks.push({
      id: 'build',
      title: 'Production build',
      type: 'command',
      run: runScript(pm, 'build'),
      required: true,
      profiles: ['balanced', 'thorough'],
      timeoutSeconds: 1800,
      appliesTo: [...SOURCE_GLOBS, '**/*.{css,scss,html,md}'],
      description: 'Runs the project build script. Excluded from the fast profile.',
    })
  }

  return checks
}

function executable(candidates: string[], cwd: string): string | undefined {
  for (const candidate of candidates) {
    if (resolveCommand(candidate, { cwd })) return candidate
  }
  return undefined
}

function suggestPython(project: DetectedProject): SuggestedCheck[] {
  const checks: SuggestedCheck[] = []
  const python = executable(['python', 'python3', 'py'], project.root)
  if (!python) return checks
  const usesPytest =
    tool(project, 'pytest') ||
    project.files.includes('pyproject.toml') ||
    project.files.includes('pytest.ini') ||
    project.files.includes('tox.ini')
  if (usesPytest) {
    checks.push({
      id: 'test',
      title: 'pytest',
      type: 'command',
      run: [python, '-m', 'pytest', '-q'],
      env: { PYTHONDONTWRITEBYTECODE: '1' },
      required: true,
      profiles: ['fast', 'balanced', 'thorough'],
      timeoutSeconds: 1800,
      appliesTo: ['**/*.py', 'pyproject.toml', 'requirements*.txt'],
      description: 'Detected a Python project with pytest.',
    })
  }
  const ruff = executable(['ruff'], project.root)
  if (ruff) {
    checks.push({
      id: 'lint',
      title: 'Ruff lint',
      type: 'command',
      run: [ruff, 'check', '.'],
      required: true,
      profiles: ['fast', 'balanced', 'thorough'],
      timeoutSeconds: 600,
      appliesTo: ['**/*.py'],
    })
  }
  return checks
}

function suggestRust(project: DetectedProject): SuggestedCheck[] {
  if (!resolveCommand('cargo', { cwd: project.root })) return []
  return [
    {
      id: 'test',
      title: 'cargo test',
      type: 'command',
      run: ['cargo', 'test', '--all-targets'],
      required: true,
      profiles: ['fast', 'balanced', 'thorough'],
      timeoutSeconds: 1800,
      appliesTo: ['**/*.rs', 'Cargo.toml', 'Cargo.lock'],
    },
    {
      id: 'build',
      title: 'cargo build',
      type: 'command',
      run: ['cargo', 'build'],
      required: true,
      profiles: ['balanced', 'thorough'],
      timeoutSeconds: 1800,
      appliesTo: ['**/*.rs', 'Cargo.toml', 'Cargo.lock'],
    },
  ]
}

function suggestGo(project: DetectedProject): SuggestedCheck[] {
  if (!resolveCommand('go', { cwd: project.root })) return []
  return [
    {
      id: 'test',
      title: 'go test',
      type: 'command',
      run: ['go', 'test', './...'],
      required: true,
      profiles: ['fast', 'balanced', 'thorough'],
      timeoutSeconds: 1800,
      appliesTo: ['**/*.go', 'go.mod', 'go.sum'],
    },
    {
      id: 'build',
      title: 'go build',
      type: 'command',
      run: ['go', 'build', './...'],
      required: true,
      profiles: ['balanced', 'thorough'],
      timeoutSeconds: 1200,
      appliesTo: ['**/*.go', 'go.mod', 'go.sum'],
    },
  ]
}

function suggestDotnet(project: DetectedProject): SuggestedCheck[] {
  if (!project.ecosystems.some((ecosystem) => ecosystem.id === 'dotnet')) return []
  if (!resolveCommand('dotnet', { cwd: project.root })) return []
  return [
    {
      id: 'test',
      title: 'dotnet test',
      type: 'command',
      run: ['dotnet', 'test', '--nologo'],
      required: true,
      profiles: ['fast', 'balanced', 'thorough'],
      timeoutSeconds: 1800,
      appliesTo: ['**/*.cs', '**/*.csproj', '**/*.sln'],
    },
  ]
}

/**
 * Build a small, honest starter plan. Suggested checks are intentionally
 * conservative: they use project scripts when present and known tool CLIs
 * otherwise. Nothing here executes during detection.
 */
export async function suggestChecks(project: DetectedProject): Promise<SuggestedCheck[]> {
  let checks: SuggestedCheck[] = []
  for (const ecosystem of project.ecosystems) {
    switch (ecosystem.id) {
      case 'node':
        checks = suggestNode(project)
        break
      case 'python':
        checks.push(...suggestPython(project))
        break
      case 'rust':
        checks.push(...suggestRust(project))
        break
      case 'go':
        checks.push(...suggestGo(project))
        break
      case 'dotnet':
        checks.push(...suggestDotnet(project))
        break
      default:
        break
    }
  }
  const seen = new Set<string>()
  checks = checks.filter((check) => {
    if (seen.has(check.id)) return false
    seen.add(check.id)
    return true
  })
  return withSecretScan(checks)
}

export function describeSuggestions(project: DetectedProject, checks: SuggestedCheck[]): string[] {
  const lines: string[] = []
  const ecosystems = project.ecosystems.map((ecosystem) => ecosystem.id).join(', ')
  lines.push(`Detected: ${ecosystems}`)
  if (project.packageManager) {
    lines.push(`Package manager: ${project.packageManager}${project.packageManagerVersion ? ` ${project.packageManagerVersion}` : ''}`)
  }
  if (project.monorepo) lines.push(`Monorepo workspaces: ${project.workspaces.length}`)
  lines.push(`Suggested checks: ${checks.map((check) => check.id).join(', ')}`)
  return lines
}

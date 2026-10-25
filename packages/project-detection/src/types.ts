import type { ChangedFilesSummary, GitInfo, Profile } from '@proofgate/shared'

export type EcosystemId =
  | 'node'
  | 'python'
  | 'rust'
  | 'go'
  | 'java'
  | 'dotnet'
  | 'ruby'
  | 'php'
  | 'unknown'

export interface EcosystemInfo {
  id: EcosystemId
  confidence: 'high' | 'medium' | 'low'
  evidence: string[]
}

export interface ToolInfo {
  id: string
  name: string
  kind: 'test' | 'lint' | 'format' | 'build' | 'runtime' | 'vcs' | 'container' | 'ci' | 'other'
  configFiles: string[]
  version?: string
}

export interface DetectedProject {
  root: string
  name: string
  ecosystems: EcosystemInfo[]
  packageManager?: 'pnpm' | 'npm' | 'yarn' | 'bun' | 'deno'
  packageManagerVersion?: string
  scripts: Record<string, string>
  tools: ToolInfo[]
  monorepo: boolean
  workspaces: string[]
  git: GitInfo
  installedDependencies: boolean
  files: string[]
}

export interface SuggestedCommandCheck {
  id: string
  title: string
  type: 'command'
  run: string[]
  env?: Record<string, string>
  required: boolean
  profiles: Profile[]
  timeoutSeconds?: number
  appliesTo?: string[]
  description?: string
}

export interface SuggestedSecretScanCheck {
  id: string
  title: string
  type: 'secret-scan'
  paths: string[]
  required: boolean
  profiles: Profile[]
  timeoutSeconds?: number
}

export type SuggestedCheck = SuggestedCommandCheck | SuggestedSecretScanCheck

export interface DetectionResult {
  project: DetectedProject
  changes: ChangedFilesSummary
}

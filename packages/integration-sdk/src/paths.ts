import os from 'node:os'
import path from 'node:path'

export function homeDir(): string {
  return os.homedir()
}

export function appDataDir(): string {
  if (process.platform === 'win32') return process.env.APPDATA ?? path.join(homeDir(), 'AppData', 'Roaming')
  if (process.platform === 'darwin') return path.join(homeDir(), 'Library', 'Application Support')
  return process.env.XDG_CONFIG_HOME ?? path.join(homeDir(), '.config')
}

export function userConfigPath(...segments: string[]): string {
  return path.join(homeDir(), ...segments)
}

export function claudeDesktopConfigPath(): string {
  if (process.platform === 'win32') return path.join(appDataDir(), 'Claude', 'claude_desktop_config.json')
  if (process.platform === 'darwin') return path.join(homeDir(), 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json')
  return path.join(appDataDir(), 'Claude', 'claude_desktop_config.json')
}

export function windsurfMcpConfigPath(): string {
  if (process.platform === 'win32') return path.join(homeDir(), '.codeium', 'windsurf', 'mcp_config.json')
  if (process.platform === 'darwin') return path.join(homeDir(), '.codeium', 'windsurf', 'mcp_config.json')
  return path.join(homeDir(), '.codeium', 'windsurf', 'mcp_config.json')
}

export function codexHome(): string {
  return process.env.CODEX_HOME ?? path.join(homeDir(), '.codex')
}

export function geminiHome(): string {
  return process.env.GEMINI_HOME ?? path.join(homeDir(), '.gemini')
}

export function openCodeHome(): string {
  // OpenCode stores global config under XDG config on Unix and %APPDATA% on Windows.
  return path.join(process.env.XDG_CONFIG_HOME ?? (process.platform === 'win32' ? appDataDir() : path.join(homeDir(), '.config')), 'opencode')
}

export function claudeUserSettingsPath(): string {
  return path.join(homeDir(), '.claude', 'settings.json')
}

export function isUserScopePath(target: string): boolean {
  const home = homeDir()
  const relative = path.relative(home, target)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

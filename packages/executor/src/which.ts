import fs from "node:fs";
import path from "node:path";

const isWindows = process.platform === "win32";

function pathExtensions(command?: string): string[] {
  if (!isWindows) return [""];
  const raw = process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD";
  const list = raw.split(";").filter(Boolean);
  if (command && path.extname(command)) {
    return ["", ...list];
  }
  return [...list, ""];
}

function isExecutableFile(filePath: string): boolean {
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) return false;
    if (isWindows) return true;
    fs.accessSync(filePath, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function tryWithExtensions(base: string, command?: string): string | undefined {
  for (const extension of pathExtensions(command ?? base)) {
    const candidate = `${base}${extension}`;
    if (isExecutableFile(candidate)) return candidate;
  }
  return undefined;
}

function localBinDirs(cwd: string): string[] {
  const dirs: string[] = [];
  let dir = path.resolve(cwd);
  for (;;) {
    dirs.push(path.join(dir, "node_modules", ".bin"));
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return dirs;
}

/**
 * Resolve an executable the way a package manager would, preferring
 * `node_modules/.bin` and then PATH. Never executes anything.
 */
export function resolveCommand(
  command: string,
  options: { cwd?: string; preferLocal?: boolean } = {},
): string | null {
  if (!command || command.includes("\0")) return null;
  const cwd = options.cwd ?? process.cwd();
  if (command.includes("/") || command.includes("\\")) {
    const candidate = path.isAbsolute(command) ? command : path.resolve(cwd, command);
    return tryWithExtensions(candidate, command) ?? null;
  }
  if (options.preferLocal !== false) {
    for (const binDir of localBinDirs(cwd)) {
      const found = tryWithExtensions(path.join(binDir, command), command);
      if (found) return found;
    }
  }
  const pathValue = process.env.PATH ?? process.env.Path ?? "";
  const delimiter = isWindows ? ";" : ":";
  const searchDirs = pathValue.split(delimiter);
  if (isWindows) {
    if (process.env.APPDATA) {
      searchDirs.push(path.join(process.env.APPDATA, "npm"));
    }
    if (process.env.LOCALAPPDATA) {
      searchDirs.push(path.join(process.env.LOCALAPPDATA, "pnpm"));
    }
    const programFiles = process.env.ProgramFiles ?? "C:\\Program Files";
    searchDirs.push(path.join(programFiles, "nodejs"));
  }
  for (const rawDir of searchDirs) {
    const dir = rawDir.trim().replace(/^"|"$/g, "");
    if (!dir) continue;
    const found = tryWithExtensions(path.join(dir, command), command);
    if (found) return found;
  }
  return null;
}

export function commandExists(command: string, options: { cwd?: string } = {}): boolean {
  return resolveCommand(command, options) !== null;
}

export function whichSync(command: string, options: { cwd?: string } = {}): string | null {
  return resolveCommand(command, options);
}

/** Quote an argv array for display only. Never used to spawn a process. */
export function formatCommand(argv: readonly string[]): string {
  return argv
    .map((part) => {
      if (/^[A-Za-z0-9_./:@%+=,-]+$/.test(part)) return part;
      const escaped = part.replace(/(["\\$`])/g, "\\$1");
      return `"${escaped}"`;
    })
    .join(" ");
}

export { localBinDirs };

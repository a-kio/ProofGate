# Contributing to ProofGate

ProofGate exists to make completion claims accountable. Contributions are welcome, but the project has a few invariants that are not negotiable.

## Invariants

1. **Evidence over claims.** A status is derived from stored check and criterion results. Never add a path that turns missing, skipped, or errored evidence into success.
2. **No model in the verdict.** AI may propose a check plan or explain a failure. It must not be able to approve acceptance criteria or change a verdict.
3. **No shell execution.** Command checks are `argv` arrays. Do not add a shell string path, `eval`, or an implicit `sh -c`.
4. **Human-owned acceptance.** `.proofgate/acceptance.yaml` and `.proofgate/acceptance.lock.json` are protected. Any change to intent hashing or approval semantics needs tests and a changelog entry.
5. **Local-first.** No telemetry, no hidden uploads, no required API key. Network access is limited to HTTP checks the user explicitly configures.
6. **Reversible integrations.** Every provider-config edit is atomic, backed up, and removable without clobbering unrelated settings.
7. **Honest limitations.** If a provider has no hook API or requires explicit trust, document that in the adapter and in the README instead of pretending otherwise.

## Development setup

Requirements: Node.js 22 or newer and pnpm 9 or newer.

```sh
git clone https://github.com/a-kio/ProofGate.git
cd ProofGate
corepack enable
pnpm install
```

Check an implemented package:

```sh
pnpm --filter @proofgate/verification typecheck
pnpm --filter @proofgate/reporting build
```

The full workspace build is wired once the CLI and dashboard entry points exist. Until then, target packages individually.

## Repository layout

```text
apps/cli               Commander CLI
apps/dashboard         React/Vite dashboard
packages/shared        Types, constants, hashing, redaction
packages/config        Schema, loading, intent, acceptance lock
packages/project-detection
packages/executor      Safe process execution
packages/verification  Plan, run, cache, criteria, status
packages/evidence      Evidence bundles and manifests
packages/storage       Run persistence
packages/reporting     Terminal, JSON, Markdown, HTML, GitHub
packages/integration-sdk
packages/integrations  Agent adapters
packages/core          Orchestration
packages/mcp-server    MCP tools
```

## Tests

Vitest is configured at the root. The suite is being built alongside the CLI; new behavior should arrive with tests under `tests/unit`, `tests/integration`, `tests/security`, or `tests/end-to-end`.

At minimum, cover:

- status derivation for every required/optional combination;
- acceptance hash invalidation and re-approval;
- cache hits only after a real `PASS`, and cache misses when the tree, tool, lockfile, or config changes;
- path containment and refusal of absolute or escaping paths;
- secret redaction before evidence is written;
- integration install, uninstall, backup, and rollback in a temporary directory;
- JSONC/TOML edits preserving unrelated keys and comments.

## Integration changes

An adapter change is not complete until it has been exercised against a temporary project and a temporary user-config directory. Verify:

1. Install creates only the expected files.
2. Existing unrelated configuration survives byte-for-byte where possible.
3. A second install is idempotent.
4. Uninstall removes only ProofGate-managed entries.
5. A failed write leaves the original files intact and reports the backup location.

## Pull requests

- Keep commits focused. Conventional Commits are preferred (`feat:`, `fix:`, `docs:`, `test:`, `refactor:`, `chore:`).
- Run the typecheck for every package you touched.
- Update the README when you change the public interface or a status contract.
- Add a `CHANGELOG.md` entry for user-visible behavior.
- Do not include generated `dist/` output, `.proofgate/runs/`, or local editor files.
- Describe the verification you performed, not just the change.

## Security

Do not open a public issue for a vulnerability. Follow [SECURITY.md](SECURITY.md).

## License

By contributing, you agree that your contribution is licensed under the Apache License 2.0, the same license as this project.

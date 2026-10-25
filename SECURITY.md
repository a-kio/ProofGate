# Security policy

## Supported versions

ProofGate is pre-release. There is no stable release yet; security fixes land on `main` and will be included in the first tagged version.

## Reporting a vulnerability

Report privately through [GitHub Security Advisories](https://github.com/a-kio/ProofGate/security/advisories/new). Do not open a public issue, pull request, or discussion for a suspected vulnerability.

Include, where possible:

- the affected package, command, or adapter;
- the ProofGate commit and your Node.js, OS, and agent versions;
- a minimal configuration and reproduction steps;
- the impact you believe is possible;
- any suggested fix.

## In scope

- Command execution that bypasses the documented `argv` contract or escapes the project root.
- Path traversal in configuration, evidence, reports, globs, or artifact paths.
- Evidence leakage: secrets that survive redaction, reports that include data outside the run directory, or manifest verification that accepts modified evidence.
- Acceptance-lock bypass: a way to change criteria, checks, profiles, or policy without invalidating approval.
- Integration edits that corrupt unrelated provider configuration, follow unsafe symlinks, or write outside the expected scope.
- HTTP check behavior that permits unintended remote requests when `allowRemote` is false.
- Denial of service through unbounded output, recursion, glob expansion, or check scheduling that ignores limits.
- Vulnerabilities in ProofGate's own dependencies that are reachable through its public surface.

## Out of scope

- Running a malicious `.proofgate/config.yaml`. ProofGate executes the commands a project defines; that is arbitrary code execution by design. Treat a project configuration with the same trust you give a `Makefile` or a CI workflow.
- Vulnerabilities in Claude Code, Codex, Cursor, Gemini CLI, Windsurf, OpenCode, or other third-party agents.
- Findings that require an already-compromised local account, administrator access, or physical access.
- Missing hardening that has no demonstrated impact beyond the documented trust model.

## Disclosure

Reports are acknowledged as soon as possible. This is a volunteer project, so no fixed response window or bug bounty is offered. Once a fix is available, we will coordinate a disclosure date with the reporter and credit them unless they prefer otherwise.

## Safe harbor

Good-faith research against your own installation, using the scope above, is welcome. We will not pursue legal action for research that respects this policy and avoids privacy violations, data destruction, and service disruption.

# Changelog

All notable changes to ProofGate are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Strict TypeScript workspace with pnpm, tsup, Biome, ESLint, and Vitest configuration.
- Configuration schema, YAML loader, unknown-key suggestions, and config explanation.
- Project, ecosystem, package-manager, tool, workspace, and Git change detection.
- Shell-free command executor with timeouts, output limits, truncation, cancellation, and environment filtering.
- Verification planner with profiles, applicability globs, dependency ordering, guards, and cycle detection.
- Command, HTTP, files, and secret-scan evaluators.
- Verification cache keyed on the check definition, profile, intent, config, working tree, tool identity, lockfiles, environment, and platform.
- Acceptance criteria evaluation and deterministic overall-status derivation.
- Human-owned acceptance locking with per-profile intent hashes and stale-intent detection.
- Evidence writer with redaction, SHA-256 manifests, bundle verification, and retention pruning.
- Run storage with an optional `node:sqlite` backend and a JSON index fallback.
- Terminal, JSON, Markdown, HTML, GitHub annotation, and GitHub step-summary reporting.
- JSON Schemas for run reports, run lists, and evidence manifests.
- Integration SDK with atomic writes, timestamped backups, transactional rollback, JSONC parsing, TOML table editing, managed Markdown blocks, and generated hook wrappers.
- Adapters for Claude Code, Claude Desktop, Codex CLI, OpenCode v1, OpenCode v2, Cursor, Gemini CLI, Windsurf, generic CLI agents, and universal MCP clients.
- Project README, logo, banner, contribution guide, security policy, and Apache-2.0 licensing.

### In progress

- `@proofgate/core` orchestration.
- MCP server built on the official SDK.
- CLI commands and provider-specific hook output.
- Local dashboard API and React UI.
- Test suites, example projects, GitHub Action, release workflows, standalone binaries, and published packages.

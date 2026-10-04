# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [v0.4.0] - 2026-10-04

### Changed

- **[BREAKING]:** Requires pi 1.0.0 or newer. Clarification and network-issue guidance is delivered as a structured `clarify` system-prompt section rather than by replacing the whole system prompt. On an older host the extension reports `pi-clarify requires pi 1.0.0 or newer` instead of quietly injecting nothing.
- `clarify_prompt` is registered with `exposure: "model-only"`, so no other tool can invoke it and open a blocking clarification dialog.
- `typebox` and the pi packages are declared as peer dependencies so the host's copies are used instead of nested duplicates.
- The `~` bypass marker is ignored when followed by a path, so prompts beginning `~/…`, `~user/…` or `~\…` reach the agent intact rather than being rewritten to a root-relative path.

### Fixed

- The one-turn bypass is invalidated by any later input, so a bypass left pending by input queued during streaming, by `steer`/`followUp` submitted while idle, or by a turn that failed before starting no longer suppresses a subsequent prompt. It also survives prompt-template and skill-command expansion, which rewrites the prompt after the input handlers run.
- `/clarify off` stops `clarify_prompt` from opening a dialog, instead of only withholding the guidance while leaving the tool callable.
- Network-error detection no longer reports unrelated failures that merely share vocabulary, such as `timeout value 500`, `src/api.ts:502`, `network is not defined`, `cannot find module 'proxy-handler'`, `rateLimit is not a function`, `Disk quota exceeded`, `1 error in 500 ms`, `429 passing` and `test timed out`. A status code or timeout now has to appear alongside a status, network or API term.
- Network-error detection recognizes `fetch failed`, `curl: (6) Could not resolve host`, `connect: connection refused`, `rate_limit_exceeded`, `TooManyRequests`, `TLS handshake failed`, `overloaded_error`, `ERR_TUNNEL_CONNECTION_FAILED`, `EPROTO`, gRPC `UNAVAILABLE`, `net::ERR_INTERNET_DISCONNECTED`, DNS resolution failures, a bare `429` or `503`, and the Windows spellings `No such host is known` and `Name or service not known`.
- Network-error detection stays linear on large single-line tool results: a 200 KB result that previously took several seconds now matches in under 10 ms, so a big payload no longer stalls the UI.
- The network reminder keeps a tool's `structuredContent`, which pi drops whenever a handler replaces content without also replacing it, and passes image content through untouched.

## [v0.3.0] - 2026-09-02

### Added

- Network/proxy issue handling: when a tool fails with a network, proxy, connectivity, or rate-limit error (timeout, ECONNREFUSED, 429, 502/503/504, etc.), the model is instructed via system prompt and a `tool_result` reminder to ask the user how to proceed (retry / switch proxy or network / wait / fallback / skip) instead of silently retrying. Governed by the existing `/clarify` toggle; no-op in RPC/print mode.

### Changed

- Updated to pi `0.84.4` (was `0.83.0`) — clears `npm audit` HIGH advisories via `undici@8.9.0` and `brace-expansion` fixes; aligns `typebox` peer to `1.3.7` (requires `typebox@^1.3.7`).
- Bumped `tsx` to `4.23.13`.

## [v0.2.0] - 2026-07-31

### Fixed

- **Bypass prefix changed from `!` to `~`.** pi reserves `!`/`!!` as the built-in shell-command prefix and short-circuits it in the interactive submit handler before the extension's `input` event fires, so the `!` bypass never actually reached the extension. `~` is unreserved and works.
- Propagate abort signal into `ui.select` and `ui.input` dialogs (previously only checked before the call; in-flight dialogs couldn't be cancelled by a streaming abort).
- Eliminated stale `lastInputWasVague` cross-handler state by computing vagueness from `event.prompt` inside `before_agent_start`.
- Append `CLARIFY_PROMPT` after the base system prompt instead of prepending, so critical base instructions keep primacy.
- Standalone `tsc --noEmit` now passes: added `@earendil-works/pi-coding-agent`, `@earendil-works/pi-tui`, `@types/node`, and `typescript` as devDependencies; enabled `allowImportingTsExtensions`; added `typecheck` script; fixed extensionless relative imports to use `.js`.

### Changed

- README now accurately describes detection as LLM-driven (via injected system-prompt guideline) with a minimal structural guard, replacing stale claims of keyword matching and a 10-character threshold.

## [v0.1.11] - 2026-07-04

### Fixed

- Avoid flagging short actionable commands as vague.

## [v0.1.10] - 2026-07-02

### Fixed

- Abort signal propagation to custom input handler for proper cancellation during clarification.
- Added `type: module` to package.json for Node.js ESM compatibility.

## [v0.1.9] - 2026-05-08

### Changed

- Updated import paths from `@mariozechner/*` to `@earendil-works/*` for pi v0.74.0 package scope migration.
- Removed `(event as any)` cast for `systemPromptOptions` — now properly typed on `BeforeAgentStartEvent`.
- Updated README link to point at the new `earendil-works/pi-mono` repository.

## [v0.1.8] - 2026-05-01

### Fixed

- `clarify_prompt` tool now passes the user's selected answer to the LLM instead of terminating the agent, allowing it to continue with the clarified understanding.

## [v0.1.7] - 2026-04-25

### Changed

- Extracted prompt constants and clarified result types to `clarify-utils.ts` for testability.
- Updated extension API usage for pi v0.71.0 compatibility.

## [v0.1.6] - 2026-04-21

### Changed

- Lowered very-short-request threshold from 20 to 10 characters.

## [v0.1.5] - 2026-04-20

### Fixed

- Migrated from `@sinclair/typebox` to `typebox` v1.x.

## [v0.1.4] - 2026-04-19

### Added

- Signal cancellation support for tool execution.
- Context-aware tool renderers for clarify_prompt call/result display.

## [v0.1.3] - 2026-04-18

### Changed

- Updated package metadata for npm registry compatibility.
- Moved sample image to `assets/` folder.

## [v0.1.2] - 2026-04-17

### Added

- Initial release of `pi-clarify` extension.
- `clarify_prompt` tool for LLM to ask clarifying questions.
- Vague input detection with pattern matching.
- `/clarify` toggle command.
- `!` bypass prefix.

[Unreleased]: https://github.com/dkmnx/pi-clarify/compare/v0.3.0...HEAD
[v0.4.0]: https://github.com/dkmnx/pi-clarify/compare/v0.3.0...v0.4.0
[v0.3.0]: https://github.com/dkmnx/pi-clarify/compare/v0.2.0...v0.3.0
[v0.2.0]: https://github.com/dkmnx/pi-clarify/compare/v0.1.11...v0.2.0
[v0.1.11]: https://github.com/dkmnx/pi-clarify/compare/v0.1.10...v0.1.11
[v0.1.10]: https://github.com/dkmnx/pi-clarify/compare/v0.1.9...v0.1.10
[v0.1.9]: https://github.com/dkmnx/pi-clarify/compare/v0.1.8...v0.1.9
[v0.1.8]: https://github.com/dkmnx/pi-clarify/compare/v0.1.7...v0.1.8
[v0.1.7]: https://github.com/dkmnx/pi-clarify/compare/v0.1.6...v0.1.7
[v0.1.6]: https://github.com/dkmnx/pi-clarify/compare/v0.1.5...v0.1.6
[v0.1.5]: https://github.com/dkmnx/pi-clarify/compare/v0.1.4...v0.1.5
[v0.1.4]: https://github.com/dkmnx/pi-clarify/compare/v0.1.3...v0.1.4
[v0.1.3]: https://github.com/dkmnx/pi-clarify/compare/v0.1.2...v0.1.3
[v0.1.2]: https://github.com/dkmnx/pi-clarify/releases/tag/v0.1.2

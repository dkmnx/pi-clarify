# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- **[BREAKING]:** Requires pi 1.0.0 or newer. Clarification and network-issue guidance now arrives as a structured `clarify` system-prompt section, a capability older hosts lack; there the extension loads but injects no guidance.
- `clarify_prompt` registers with `exposure: "model-only"`, so no other tool can call it and open a blocking clarification dialog.
- `typebox` is declared as a peer dependency so pi's copy is used instead of a nested duplicate.
- The `~` bypass marker no longer triggers when followed by a path, so prompts beginning `~/…`, `~user/…` or `~\…` pass through untouched instead of being rewritten to a root-relative path. Windows separators count too, which matters because pi renders its cwd that way.

### Fixed

- A prompt submitted while the agent is streaming no longer strands the one-turn bypass. A new input now invalidates any bypass still pending, so one that never reached a turn expires instead of suppressing a later prompt. This also covers `steer`/`followUp` submitted while idle, which reach the input event with `streamingBehavior` blanked and are indistinguishable from a fresh prompt.
- The one-turn bypass now survives prompt-template and skill-command expansion, which rewrites the prompt after the input handlers run and previously caused the bypass to be silently dropped.
- `/clarify off` now stops `clarify_prompt` from opening a dialog. The tool stayed registered when clarification was disabled, so the model could still block on a prompt the user had turned off.
- Network-error detection no longer fires on unrelated failures that merely share vocabulary: `timeout value 500`, `src/api.ts:502`, `network is not defined`, `cannot find module 'proxy-handler'`, `rateLimit is not a function`, `Disk quota exceeded`, `1 error in 500 ms`, `error code 500`, `429 passing` and `test timed out` are no longer reported as network problems. A status code or timeout now has to arrive with a status, network or API term rather than on its own.
- Network-error detection now catches common real failures it previously missed, including `fetch failed`, `curl: (6) Could not resolve host`, `connect: connection refused`, `rate_limit_exceeded`, `TooManyRequests`, `TLS handshake failed`, `overloaded_error`, `ERR_TUNNEL_CONNECTION_FAILED`, `EPROTO`, gRPC `UNAVAILABLE`, `net::ERR_INTERNET_DISCONNECTED`, DNS resolution failures and a bare `429` or `503`.
- Windows DNS failures (`No such host is known`, `Name or service not known`) are now recognised. That is the dominant spelling on Windows and was previously missed entirely.
- Network-error detection no longer degrades quadratically on large single-line tool results. Bounding the status-code lookaheads takes a 200 KB result from several seconds to under a millisecond, so a big payload no longer stalls the UI.
- The network reminder no longer discards a tool's `structuredContent`. pi drops it when a handler replaces content without also replacing it, so the original is echoed back and the tool's structured output survives. The reminder is now composed where pi types the tool result, so the patch needs no type assertion and image content in a tool result is no longer narrowed away.

### Added

- `e2e.test.ts`: loads the extension through pi's own loader and drives the real `ExtensionRunner`, covering prompt-section injection, tool exposure, the `~` bypass, the queued-input path, structured-content preservation and the disabled-tool guard.

## [0.3.0] - 2026-09-02

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

## [0.1.9] - 2026-05-08

### Changed

- Updated import paths from `@mariozechner/*` to `@earendil-works/*` for pi v0.74.0 package scope migration.
- Removed `(event as any)` cast for `systemPromptOptions` — now properly typed on `BeforeAgentStartEvent`.
- Updated README link to point at the new `earendil-works/pi-mono` repository.

## [0.1.8] - 2026-05-01

### Fixed

- `clarify_prompt` tool now passes the user's selected answer to the LLM instead of terminating the agent, allowing it to continue with the clarified understanding.

## [0.1.7] - 2026-04-25

### Changed

- Extracted prompt constants and clarified result types to `clarify-utils.ts` for testability.
- Updated extension API usage for pi v0.71.0 compatibility.

## [0.1.6] - 2026-04-21

### Changed

- Lowered very-short-request threshold from 20 to 10 characters.

## [0.1.5] - 2026-04-20

### Fixed

- Migrated from `@sinclair/typebox` to `typebox` v1.x.

## [0.1.4] - 2026-04-19

### Added

- Signal cancellation support for tool execution.
- Context-aware tool renderers for clarify_prompt call/result display.

## [0.1.3] - 2026-04-18

### Changed

- Updated package metadata for npm registry compatibility.
- Moved sample image to `assets/` folder.

## [0.1.2] - 2026-04-17

### Added

- Initial release of `pi-clarify` extension.
- `clarify_prompt` tool for LLM to ask clarifying questions.
- Vague input detection with pattern matching.
- `/clarify` toggle command.
- `!` bypass prefix.

[Unreleased]: https://github.com/dkmnx/pi-clarify/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/dkmnx/pi-clarify/compare/v0.2.0...v0.3.0
[v0.2.0]: https://github.com/dkmnx/pi-clarify/compare/v0.1.11...v0.2.0
[v0.1.11]: https://github.com/dkmnx/pi-clarify/compare/v0.1.10...v0.1.11
[v0.1.10]: https://github.com/dkmnx/pi-clarify/compare/v0.1.9...v0.1.10
[0.1.9]: https://github.com/dkmnx/pi-clarify/compare/v0.1.8...v0.1.9
[0.1.8]: https://github.com/dkmnx/pi-clarify/compare/v0.1.7...v0.1.8
[0.1.7]: https://github.com/dkmnx/pi-clarify/compare/v0.1.6...v0.1.7
[0.1.6]: https://github.com/dkmnx/pi-clarify/compare/v0.1.5...v0.1.6
[0.1.5]: https://github.com/dkmnx/pi-clarify/compare/v0.1.4...v0.1.5
[0.1.4]: https://github.com/dkmnx/pi-clarify/compare/v0.1.3...v0.1.4
[0.1.3]: https://github.com/dkmnx/pi-clarify/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/dkmnx/pi-clarify/releases/tag/v0.1.2

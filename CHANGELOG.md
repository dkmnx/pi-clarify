# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [v0.2.0] - Unreleased

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

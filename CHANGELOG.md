# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.8] - 2026-05-01

### Fixed

- `clarify_prompt` tool now passes the user's selected answer to the LLM instead of terminating the agent, allowing it to continue with the clarified understanding.

## [0.1.7] - 2026-04-25

### Changed

- Extracted prompt constants and clarified result types to `clarify-utils.ts` for testability.
- Refactored `buildClarifyAgentStartResult` interface.

## [0.1.6] - 2026-04-21

### Added

- Initial release of `pi-clarify` extension.
- `clarify_prompt` tool for LLM to ask clarifying questions.
- Vague input detection with pattern matching.
- `/clarify` toggle command.
- `!` bypass prefix.

[0.1.8]: https://github.com/dkmnx/pi-clarify/compare/v0.1.7...v0.1.8
[0.1.7]: https://github.com/dkmnx/pi-clarify/compare/v0.1.6...v0.1.7
[0.1.6]: https://github.com/dkmnx/pi-clarify/releases/tag/v0.1.6

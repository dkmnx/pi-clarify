# pi-clarify

## Project

`@dkmnx/pi-clarify`, a pi coding agent extension. It registers a `clarify_prompt` tool and
injects a structured `clarify` system-prompt section so the model asks the user for
clarification on vague prompts and on network or proxy tool failures. pi loads it directly as
raw TypeScript, so every runtime import has to resolve in pi's host environment.

## Commands

- `npm test` — both suites (`index.test.ts`, then `e2e.test.ts`); a failure in either aborts the chain
- `npm run test:unit` — `clarify-utils.ts` helpers only
- `npm run test:e2e` — loads the extension through pi's real loader and `ExtensionRunner`
- `npm run typecheck` — `tsc --noEmit`
- `pi install /path/to/pi-clarify` — registers this working tree with pi without copying it, so
  edits take effect on the next pi start. This is the loop for driving a change in a real pi session

There is no linter, formatter, or CI here, and no test framework: each suite is a plain
`node --import tsx` script that collects its cases and calls `process.exit` on the failure count
(`index.test.ts` builds a `TestCase[]`, `e2e.test.ts` defines a `test()` helper).

## Layout

| File               | Role                                                                                 |
| ------------------ | ------------------------------------------------------------------------------------ |
| `index.ts`         | The only entry in `package.json` `pi.extensions`; event wiring and tool registration |
| `clarify-utils.ts` | Pure helpers and prompt constants, no pi imports. Both suites import from here       |
| `index.test.ts`    | Unit tests for `clarify-utils.ts`                                                    |
| `e2e.test.ts`      | Drives the extension through pi's real `ExtensionRunner`                             |

Tests import `./clarify-utils.ts` and runtime code imports `./clarify-utils.js`; keep the split.
`tsconfig.json` permits both spellings rather than enforcing either: `allowImportingTsExtensions`
makes the `.ts` form legal, and `module: "Node16"` with `"type": "module"` requires the `.js` form
at runtime. Its `include` is `["*.ts"]`, so a module in a subdirectory is typechecked only once an
included file imports it.

## Boundaries

- `index.ts` must keep its `export default function (pi: ExtensionAPI)`. pi loads a default
  factory and nothing else; renaming it to a named export loads zero extensions.
- Never return `systemPrompt` from `before_agent_start`. It sets `forceSystemPrompt`, and pi's
  `buildSystemPromptState` then drops every structured section and replaces the prompt wholesale.
  Write into `systemPromptOptions.sections.clarify` so pi records a transcript delta.
- The extension needs pi `1.0.0` or newer. `MIN_PI_VERSION` and `assertPromptSectionsSupported`
  guard the one field older hosts lack: writing to `systemPromptOptions.sections` unguarded raises
  a bare `TypeError` that pi's runner swallows, leaving clarification dead on a session that still
  looks healthy.
- Prompt section names must match `/^[a-z][a-z0-9_-]*$/` and must not be `preamble`. pi throws on
  anything else outside the runner's try/catch, which breaks every user turn.
- Keep `clarify_prompt` at `exposure: "model-only"`. The `direct` default lets any other tool invoke
  it through `ctx.executeTool()` and open a blocking modal.
- A `tool_result` patch that replaces `content` must echo `structuredContent` back: pi deletes it
  when the patch omits it. `details` is only overwritten when supplied, never dropped.
- `package.json` `files` is the published surface. A new runtime module missing from it ships broken.
- The three host packages are declared twice, deliberately. `peerDependencies` uses `"*"` so the
  host's copy wins over a nested duplicate and the extension ships no runtime dependency of its own;
  `devDependencies` pins what local `npm run typecheck` and `npm run test:e2e` compile and run
  against (pi at `^1.0.0`, typebox at `^1.3.7`). The `"*"` range does not enforce the pi floor, so
  a stale host is caught at runtime instead.
- Network detection rejects bare words. `timeout`, `network`, `proxy` and `quota` match only with a
  qualifier attached, because they occur constantly in unrelated failures. A bare HTTP status counts
  only when the line is essentially just a status or is introduced by an explicit status word, which
  is why `api.ts:502` stays quiet while a lone `429` is flagged. Some entries stay context-free on
  purpose (`/fetch failed/`, `/socket hang up/`, `/代理|网络|超时|连接被拒绝/`); do not tighten them
  without a failing test first.
- Changelog entries for unshipped work go under `## [Unreleased]`. Do not add or date a version
  section for work that has not shipped.
- In `e2e.test.ts`, `ExtensionRunner` swallows handler exceptions and surfaces them only through
  `runner.onError`. A new assertion that skips the existing `runtimeErrors` guard stays green while
  the extension is broken. TUI-gated paths need `runner.setUIContext(uiStub(), "tui")`.

## Code style

Named exports and `import type` for types, except the default factory pi requires in `index.ts`.
Test-facing exports in `clarify-utils.ts` carry a docblock: most open with
`/** Exported for testing: ... */`, and the rest are one-liners, some explaining the constraint
they encode. `buildClarifyAgentStartResult` is the one export with no docblock.

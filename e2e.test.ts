/**
 * End-to-end tests: load this extension through pi's real extension loader and
 * drive it with pi's real ExtensionRunner. These assert the contract pi actually
 * consumes, not the shape of our own return values.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import {
  discoverAndLoadExtensions,
  ExtensionRunner,
  ModelRegistry,
  ModelRuntime,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import type {
  BeforeAgentStartCustomEvent,
  BuildSystemPromptOptions,
  ExtensionUIContext,
} from "@earendil-works/pi-coding-agent";

import { CLARIFY_PROMPT, CLARIFY_SECTION_NAME, CLARIFY_TOOL_NAME, NETWORK_ISSUE_PROMPT } from "./clarify-utils.ts";

const projectDir = path.dirname(fileURLToPath(import.meta.url));
const extensionPath = path.join(projectDir, "index.ts");

/**
 * pi's buildSystemPromptSections throws on a name outside its
 * SYSTEM_PROMPT_SECTION_NAME regex, and on "preamble" specifically. That call runs
 * outside the runner's try/catch, so an illegal name breaks every user turn with
 * nothing to catch it in the extension. Takes a string, not the constant, so the
 * rule stays live if the constant is ever renamed.
 */
function isPiSectionName(name: string): boolean {
  return /^[a-z][a-z0-9_-]*$/.test(name) && name !== "preamble";
}

/** Stands in for the terminal so the extension's TUI-gated paths are reachable.
 * The behaviour under test is the extension's, not the UI's. */
function uiStub() {
  return {
    select: async () => undefined,
    confirm: async () => false,
    input: async () => undefined,
    notify: () => {},
  };
}

interface TestCase {
  name: string;
  run: () => void | Promise<void>;
}

function runTests() {
  let passed = 0;
  let failed = 0;
  const tests: TestCase[] = [];

  function test(name: string, run: () => void | Promise<void>) {
    tests.push({ name, run });
  }

  async function main() {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-clarify-e2e-"));

    try {
      const loaded = await discoverAndLoadExtensions([extensionPath], tempDir, tempDir);
      if (loaded.errors.length > 0) {
        throw new Error(`pi failed to load the extension: ${JSON.stringify(loaded.errors)}`);
      }
      if (loaded.extensions.length !== 1) {
        throw new Error(`Expected exactly 1 extension, got ${loaded.extensions.length}`);
      }

      const sessionManager = SessionManager.create(tempDir, tempDir);
      const modelRegistry = new ModelRegistry(
        await ModelRuntime.create({
          authPath: path.join(tempDir, "auth.json"),
          modelsPath: null,
        }),
      );

      const runner = new ExtensionRunner(loaded.extensions, loaded.runtime, tempDir, sessionManager, modelRegistry);
      const runtimeErrors: string[] = [];
      runner.onError((error) => runtimeErrors.push(error.error));

      // pi builds baseSystemPromptOptions.selectedTools from the active tool set
      // (AgentSession._rebuildSystemPrompt filters activeToolNames against the tool
      // registry), so a live session lists clarify_prompt here.
      const activeTools = ["read", "bash", "edit", "write", CLARIFY_TOOL_NAME];

      // Audit: pi 1.2.0 made the event a union on messageType and moved the run
      // trigger into its own argument. The old three-arg call left the options
      // undefined, which pi dereferences before any handler runs.
      type EmitTrigger =
        | { messageType: "user"; prompt: string }
        | { messageType: "custom"; message: BeforeAgentStartCustomEvent["message"] };

      const emitTrigger = async (
        trigger: EmitTrigger,
        options: Partial<BuildSystemPromptOptions> = {},
      ) => {
        const result = await runner.emitBeforeAgentStart(trigger, {
          cwd: tempDir,
          selectedTools: activeTools,
          ...options,
        });
        // ExtensionRunner swallows handler exceptions and reports them only via
        // onError, so a thrown handler would otherwise leave every assertion below
        // green while the extension silently stopped working.
        if (runtimeErrors.length > 0) {
          throw new Error(`Extension handler errored: ${runtimeErrors.join("; ")}`);
        }
        return result;
      };

      const emit = (prompt: string, options: Partial<BuildSystemPromptOptions> = {}) =>
        emitTrigger({ messageType: "user", prompt }, options);

      test("pi loads the extension without reporting errors", () => {
        if (runtimeErrors.length > 0) {
          throw new Error(`Extension runtime reported errors: ${runtimeErrors.join("; ")}`);
        }
      });

      test("the section name is one pi will accept", () => {
        if (!isPiSectionName(CLARIFY_SECTION_NAME)) {
          throw new Error(`pi rejects this section name: '${CLARIFY_SECTION_NAME}'`);
        }
      });

      test("clarify_prompt registers as model-only, so other tools cannot invoke it", () => {
        const definition = runner.getToolDefinition(CLARIFY_TOOL_NAME);
        if (!definition) {
          throw new Error(`Expected tool '${CLARIFY_TOOL_NAME}' to be registered`);
        }
        if (definition.exposure !== "model-only") {
          throw new Error(
            `Expected exposure 'model-only', got '${definition.exposure}'. 'direct' would expose this blocking prompt via ctx.executeTool().`,
          );
        }
      });

      test("pi receives the clarify instructions as a structured prompt section", async () => {
        const { systemPromptOptions } = await emit("Add a login endpoint to src/api/routes.ts");

        const section = systemPromptOptions.sections[CLARIFY_SECTION_NAME];
        if (!section) {
          throw new Error(
            `Expected a '${CLARIFY_SECTION_NAME}' section. Got sections: ${JSON.stringify(Object.keys(systemPromptOptions.sections))}`,
          );
        }
        if (!section.includes(CLARIFY_PROMPT)) {
          throw new Error("Expected the section to carry CLARIFY_PROMPT");
        }
        if (!section.includes(NETWORK_ISSUE_PROMPT)) {
          throw new Error("Expected the section to carry NETWORK_ISSUE_PROMPT");
        }
      });

      test("forceSystemPrompt stays unset, so pi keeps its structured sections", async () => {
        const { systemPromptOptions } = await emit("Add a login endpoint to src/api/routes.ts");

        if (systemPromptOptions.forceSystemPrompt !== undefined) {
          throw new Error(
            "forceSystemPrompt is set, which makes pi's buildSystemPromptState drop every structured section",
          );
        }
      });

      test("the section survives alongside pi's own prompt sections", async () => {
        const { systemPromptOptions } = await emit("hello", {
          customPrompt: "BASE PROMPT",
          sections: { other_extension: "<other>keep me</other>" },
        });

        if (systemPromptOptions.sections.other_extension !== "<other>keep me</other>") {
          throw new Error("Expected another extension's section to survive the handler");
        }
        if (!systemPromptOptions.sections[CLARIFY_SECTION_NAME]) {
          throw new Error("Expected the clarify section to survive pi's own prompt options");
        }
      });

      test("no clarify section when the tool is not in the active tool set", async () => {
        const { systemPromptOptions } = await emit("hello", { selectedTools: ["read", "bash"] });

        if (CLARIFY_SECTION_NAME in systemPromptOptions.sections) {
          throw new Error("Expected no clarify section when clarify_prompt is inactive");
        }
      });

      test("a structurally empty prompt adds the hidden reminder message", async () => {
        const { messages } = await emit("?");

        if (messages.length !== 1) {
          throw new Error(`Expected 1 message, got ${messages.length}`);
        }
        if (messages[0].customType !== "clarify-reminder") {
          throw new Error(`Expected customType 'clarify-reminder', got '${messages[0].customType}'`);
        }
        if (messages[0].display !== false) {
          throw new Error("Expected the reminder to stay hidden from the user");
        }
      });

      test("a turn without a prompt gets the section, no reminder, and no error", async () => {
        // Audit: protects the promptless turn pi 1.2+ starts on sendMessage
        // { triggerTurn: true } (pi-subagents results, pi-intercom messages), where
        // the event is built from the custom message and carries no prompt field.
        // Regression: issue #3, isVagueInput(event.prompt) threw "Cannot read
        // properties of undefined (reading 'trim')" on every such turn. The old
        // version faked it with `undefined as unknown as string`, which the 1.4.0
        // trigger union rejects and which never exercised the custom branch. No
        // test-only seam: the runner builds the same event pi builds.
        const { systemPromptOptions, messages } = await emitTrigger({
          messageType: "custom",
          message: {
            role: "custom",
            customType: "pi-subagents",
            content: "subagent finished: 3 files changed",
            display: false,
            timestamp: Date.now(),
          },
        });

        if (!systemPromptOptions.sections[CLARIFY_SECTION_NAME]) {
          throw new Error("Expected a promptless turn to still receive the clarify section");
        }
        if (messages.length !== 0) {
          throw new Error(
            `Expected no vague reminder for a turn with no user prompt, got ${messages.length}`,
          );
        }
      });

      test("the section still lands for a short prompt the model must judge", async () => {
        // isVagueInput only flags structurally empty input. Semantic vagueness like
        // "fix it" is left to the model reading the injected section, so the section
        // must be present even when no reminder message is.
        const { systemPromptOptions, messages } = await emit("fix it");

        if (!systemPromptOptions.sections[CLARIFY_SECTION_NAME]) {
          throw new Error("Expected the clarify section to be injected for 'fix it'");
        }
        if (messages.length !== 0) {
          throw new Error(`Expected no reminder for a short but actionable prompt, got ${messages.length}`);
        }
      });

      test("a clear prompt adds no reminder message", async () => {
        const { messages } = await emit(
          "Add user authentication with login and signup endpoints using JWT in src/auth/ and write tests for both",
        );

        if (messages.length !== 0) {
          throw new Error(`Expected no messages for a clear prompt, got ${messages.length}`);
        }
      });

      test("a ~ prefixed home path is left intact and does not bypass", async () => {
        const input = await runner.emitInput("~/src/index.ts fails to compile", undefined, "interactive");
        if (input.action !== "continue") {
          throw new Error(`Expected '~/src/...' to pass through untouched, got '${input.action}'`);
        }
        const backslash = await runner.emitInput(
          "~\\Documents\\notes.md summarize",
          undefined,
          "interactive",
        );
        if (backslash.action !== "continue") {
          throw new Error(`Expected '~\\Documents\\...' to pass through untouched, got '${backslash.action}'`);
        }
        const { systemPromptOptions } = await emit("~/src/index.ts fails to compile");
        if (!systemPromptOptions.sections[CLARIFY_SECTION_NAME]) {
          throw new Error("Expected '~/src/...' to still receive the clarify section");
        }
      });

      test("input queued while streaming does not strand the bypass on a later turn", async () => {
        // pi queues steer/followUp input and returns before emitting
        // before_agent_start, so a queued '~' can never be consumed there.
        const queued = await runner.emitInput("~steered input", undefined, "interactive", "steer");
        if (queued.action !== "continue") {
          throw new Error("Expected queued input to pass through untouched");
        }
        const { systemPromptOptions } = await emit("a later ordinary prompt");
        if (!systemPromptOptions.sections[CLARIFY_SECTION_NAME]) {
          throw new Error(
            "Expected the queued '~' NOT to suppress clarification on the following turn",
          );
        }
      });

      test("a queued-style input with no streamingBehavior cannot suppress a different prompt", async () => {
        // steer() issued while idle reaches the input handler with streamingBehavior
        // blanked, so nothing in the event says the prompt is queued. A later user
        // prompt must invalidate the pending bypass.
        await runner.emitInput("~steered input", undefined, "interactive");
        await runner.emitInput("a later ordinary prompt", undefined, "interactive");
        const { systemPromptOptions } = await emit("a later ordinary prompt");
        if (!systemPromptOptions.sections[CLARIFY_SECTION_NAME]) {
          throw new Error("Expected an unrelated prompt to still receive the clarify section");
        }
      });

      test("a bypass survives prompt-template expansion, which rewrites the prompt", async () => {
        // pi expands skill commands and templates after the input handlers run, so
        // the text the agent sees is not the text the extension saw.
        await runner.emitInput("~ /review", undefined, "interactive");
        const { systemPromptOptions } = await emit("expanded template body");
        if (CLARIFY_SECTION_NAME in systemPromptOptions.sections) {
          throw new Error("Expected the bypass to survive expansion of the prompt text");
        }
      });

      test("a bypass that never reaches a turn expires instead of suppressing the next prompt", async () => {
        // A turn that fails before before_agent_start (missing credentials, say)
        // leaves the bypass pending with no turn to consume it.
        await runner.emitInput("~just do it", undefined, "interactive");
        await runner.emitInput("just do it", undefined, "interactive");
        const { systemPromptOptions } = await emit("just do it");
        if (!systemPromptOptions.sections[CLARIFY_SECTION_NAME]) {
          throw new Error("Expected a stale bypass to expire rather than suppress the next prompt");
        }
      });

      test("the network reminder appends and keeps the tool's structuredContent", async () => {
        // pi deletes structuredContent when a patch replaces content without it.
        try {
          runner.setUIContext(uiStub() as unknown as ExtensionUIContext, "tui");
          const structuredContent = { exitCode: 1, stderr: "boom" };
          const patch = await runner.emitToolResult({
            type: "tool_result",
            toolCallId: "call-net-1",
            toolName: "bash",
            details: undefined,
            input: {},
            content: [{ type: "text", text: "connect ECONNREFUSED 127.0.0.1:8080" }],
            isError: true,
            structuredContent,
          });
          const textOf = (block: unknown): string => {
            const b = block as { type?: string; text?: string };
            return b?.type === "text" ? (b.text ?? "") : "";
          };
          if (!patch?.content || patch.content.length !== 2) {
            throw new Error(`Expected the original block plus a reminder, got ${patch?.content?.length}`);
          }
          if (!textOf(patch.content[0]).includes("ECONNREFUSED")) {
            throw new Error("Expected the original error text to survive");
          }
          if (!textOf(patch.content[1]).includes("NETWORK/PROXY ISSUE DETECTED")) {
            throw new Error("Expected the reminder text to be appended");
          }
          if (!patch.structuredContent) {
            throw new Error("Expected structuredContent to survive the reminder patch");
          }
          if (JSON.stringify(patch.structuredContent) !== JSON.stringify(structuredContent)) {
            throw new Error(
              `Expected the original structuredContent unchanged, got ${JSON.stringify(patch.structuredContent)}`,
            );
          }
        } finally {
          runner.setUIContext(undefined);
        }
      });

      test("the network reminder also fires where dialogs work, such as RPC", async () => {
        // Audit: protects the tool_result gate. RPC mode installs a UI context, so
        // clarify_prompt opens dialogs there, but the per-result reminder required
        // mode "tui" and never fired for RPC clients. The model read the
        // NETWORK_ISSUE_PROMPT section but got no nudge on the failed result itself.
        // Coverage gap: every other tool_result test sets mode "tui". No test-only
        // seam: setUIContext is the runner's own API.
        try {
          runner.setUIContext(uiStub() as unknown as ExtensionUIContext, "rpc");
          const patch = await runner.emitToolResult({
            type: "tool_result",
            toolCallId: "call-net-rpc",
            toolName: "bash",
            details: undefined,
            input: {},
            content: [{ type: "text", text: "connect ECONNREFUSED 127.0.0.1:8080" }],
            isError: true,
          });
          if (!patch?.content || patch.content.length !== 2) {
            throw new Error(`Expected the error plus a reminder in RPC mode, got ${patch?.content?.length}`);
          }
          const reminder = patch.content[1] as { type?: string; text?: string };
          if (reminder.type !== "text" || !reminder.text?.includes("NETWORK/PROXY ISSUE DETECTED")) {
            throw new Error(`Expected the reminder text, got ${JSON.stringify(reminder)}`);
          }
        } finally {
          runner.setUIContext(undefined);
        }
      });

      test("a network error without a UI gets no reminder", async () => {
        // Audit: protects the other half of the same gate. The reminder tells the
        // model to open a dialog, so it must not fire where no dialog exists.
        // Regression: a gate of `enabled` alone appends the reminder in print and
        // JSON mode, where clarify_prompt can only return a text fallback.
        // Coverage gap: setUIContext(undefined) is the print-mode state and no test
        // asserted the negative case. No test-only seam: the runner's own default.
        runner.setUIContext(undefined);
        const errorsBefore = runtimeErrors.length;
        const patch = await runner.emitToolResult({
          type: "tool_result",
          toolCallId: "call-net-noui",
          toolName: "bash",
          details: undefined,
          input: {},
          content: [{ type: "text", text: "connect ECONNREFUSED 127.0.0.1:8080" }],
          isError: true,
        });
        // A handler that throws also returns undefined here, which would pass the
        // assertion above while the extension is broken.
        if (runtimeErrors.length !== errorsBefore) {
          throw new Error(
            `Extension handler errored: ${runtimeErrors.slice(errorsBefore).join("; ")}`,
          );
        }
        if (patch !== undefined) {
          throw new Error("Expected no reminder when the host has no UI");
        }
      });

      test("a non-network error gets no reminder", async () => {
        try {
          runner.setUIContext(uiStub() as unknown as ExtensionUIContext, "tui");
          const patch = await runner.emitToolResult({
            type: "tool_result",
            toolCallId: "call-net-2",
            toolName: "bash",
            details: undefined,
            input: {},
            content: [{ type: "text", text: "SyntaxError: Unexpected token } at position 429" }],
            isError: true,
          });
          if (patch !== undefined) {
            throw new Error("Expected no reminder for a non-network error");
          }
        } finally {
          runner.setUIContext(undefined);
        }
      });

      test("the tool returns the picked option, the typed answer, or a text fallback", async () => {
        // Audit: protects clarify_prompt's four exits. A wrong exit aborts the run
        // (ctx.abort) or answers the model "User cancelled." after the user typed a
        // reply.
        // Regression: the freeform option is matched by exact string, so renaming it
        // in the prompt or in ensureOtherOption makes the match miss. A typed answer
        // then comes back as "User answered: <label>" with wasOther false, and the
        // model never sees the text.
        // Coverage gap: no test reached the freeform branch, the empty-answer guard,
        // or the cancel exit, which is the only exit that kills the turn.
        // Seam check: the stub ctx matches the one the disabled-path test uses, and
        // the tool still runs through its registered definition. No production seam.
        const definition = runner.getToolDefinition(CLARIFY_TOOL_NAME);
        if (!definition?.execute) {
          throw new Error("Expected clarify_prompt to expose an execute function");
        }
        const params = {
          question: "Which one?",
          options: ["Option A", "Option B", "Option C"],
        };
        let aborts = 0;
        let dialogs = 0;

        const run = (ctx: Record<string, unknown>) =>
          definition.execute(
            "call-answer",
            params,
            undefined,
            () => {},
            {
              abort: () => {
                aborts++;
              },
              ...ctx,
            } as never,
          );

        let offered: string[] = [];
        const picked = await run({
          hasUI: true,
          ui: {
            select: async (_title: string, options: string[]) => {
              offered = options;
              dialogs++;
              return "Option B";
            },
            input: async () => undefined,
          },
        });
        // ensureOtherOption appends the freeform entry. Without it the user has no
        // way to type an answer, and every stub above still returns a value.
        if (offered.length !== params.options.length + 1 || !offered.includes("Your answer...")) {
          throw new Error(`Expected the options plus the freeform entry, got ${JSON.stringify(offered)}`);
        }
        if (!JSON.stringify(picked.content).includes("User answered: Option B")) {
          throw new Error(`Expected the picked option, got ${JSON.stringify(picked.content)}`);
        }
        const pickedDetails = picked.details as { answer?: string; wasOther?: boolean };
        if (pickedDetails.answer !== "Option B" || pickedDetails.wasOther !== false) {
          throw new Error(`Expected answer 'Option B', got ${JSON.stringify(pickedDetails)}`);
        }
        if (aborts !== 0) {
          throw new Error("Expected no abort when the user picked an option");
        }

        const typed = await run({
          hasUI: true,
          ui: {
            select: async () => {
              dialogs++;
              return "Your answer...";
            },
            input: async () => "  deploy to staging  ",
          },
        });
        if (!JSON.stringify(typed.content).includes("User answered: deploy to staging")) {
          throw new Error(`Expected the trimmed typed answer, got ${JSON.stringify(typed.content)}`);
        }
        const typedDetails = typed.details as { answer?: string; wasOther?: boolean };
        if (typedDetails.answer !== "deploy to staging" || typedDetails.wasOther !== true) {
          throw new Error(`Expected wasOther with the typed answer, got ${JSON.stringify(typedDetails)}`);
        }
        if (aborts !== 0) {
          throw new Error("Expected no abort when the user typed an answer");
        }

        const dialogsBefore = dialogs;
        const headless = await run({
          hasUI: false,
          ui: {
            select: async () => {
              dialogs++;
              return "Option A";
            },
            input: async () => "never asked",
          },
        });
        if (!JSON.stringify(headless.content).includes("Which one?")) {
          throw new Error(`Expected the question as text without UI, got ${JSON.stringify(headless.content)}`);
        }
        if (dialogs !== dialogsBefore) {
          throw new Error("Expected no dialog when the host has no UI");
        }
        if (aborts !== 0) {
          throw new Error("Expected no abort when the host has no UI");
        }

        const abortsBefore = aborts;
        const empty = await run({
          hasUI: true,
          ui: { select: async () => "Your answer...", input: async () => "   " },
        });
        if (!JSON.stringify(empty.content).includes("User cancelled.")) {
          throw new Error(`Expected a blank typed answer to cancel, got ${JSON.stringify(empty.content)}`);
        }
        if ((empty.details as { skipped?: boolean }).skipped !== true) {
          throw new Error("Expected the blank answer to report skipped");
        }

        const cancelled = await run({
          hasUI: true,
          ui: { select: async () => undefined, input: async () => undefined },
        });
        if (!JSON.stringify(cancelled.content).includes("User cancelled.")) {
          throw new Error(`Expected a dismissed dialog to cancel, got ${JSON.stringify(cancelled.content)}`);
        }
        if ((cancelled.details as { skipped?: boolean }).skipped !== true) {
          throw new Error("Expected the dismissed dialog to report skipped");
        }
        if (aborts !== abortsBefore + 2) {
          throw new Error(`Expected one abort per cancel, got ${aborts - abortsBefore}`);
        }
      });

      test("/clarify off stops the tool from opening a dialog", async () => {
        let dialogsOpened = 0;
        runner.setUIContext(
          {
            ...uiStub(),
            select: async () => {
              dialogsOpened++;
              return "Option A";
            },
          } as unknown as ExtensionUIContext,
          "tui",
        );

        const command = runner.getCommand("clarify");
        if (!command) throw new Error("Expected the clarify command to be registered");
        await command.handler("off", { ui: { notify: () => {} } } as never);

        try {
          const definition = runner.getToolDefinition(CLARIFY_TOOL_NAME);
          if (!definition?.execute) {
            throw new Error("Expected clarify_prompt to expose an execute function");
          }
          const result = await definition.execute(
            "call-off-1",
            { question: "Which one?", options: ["Option A", "Option B", "Option C"] },
            undefined,
            () => {},
            {
              hasUI: true,
              ui: { select: async () => { dialogsOpened++; return "Option A"; }, input: async () => undefined },
              abort: () => {},
            } as never,
          );

          if (dialogsOpened !== 0) {
            throw new Error("Expected no dialog while clarification is disabled");
          }
          if (!JSON.stringify(result.content).includes("disabled")) {
            throw new Error("Expected the tool to report that clarification is disabled");
          }
        } finally {
          await command.handler("on", { ui: { notify: () => {} } } as never);
        }
      });

      test("the ~ bypass prefix suppresses the section for one turn", async () => {
        await runner.emitInput("~just do it", undefined, "interactive");
        const bypassed = await emit("just do it");
        if (CLARIFY_SECTION_NAME in bypassed.systemPromptOptions.sections) {
          throw new Error("Expected the ~ prefix to suppress the clarify section");
        }

        // bypassNextTurn is consumed per turn, so the next prompt must clarify again.
        const next = await emit("just do it");
        if (!next.systemPromptOptions.sections[CLARIFY_SECTION_NAME]) {
          throw new Error("Expected the clarify section to return on the turn after a bypass");
        }
      });

      test("the ~ prefix is stripped from the text the agent receives", async () => {
        const input = await runner.emitInput("~just do it", undefined, "interactive");
        if (input.action !== "transform") {
          throw new Error(`Expected input action 'transform', got '${input.action}'`);
        }
        if (input.text !== "just do it") {
          throw new Error(`Expected the ~ prefix to be stripped, got '${input.text}'`);
        }
      });

      console.log("Running pi-clarify end-to-end tests against pi's real extension runner...\n");

      for (const t of tests) {
        try {
          await t.run();
          console.log(`PASS  ${t.name}`);
          passed++;
        } catch (error) {
          console.log(`FAIL  ${t.name}`);
          console.log(`      ${error instanceof Error ? error.message : String(error)}`);
          failed++;
        }
      }
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }

    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed > 0 ? 1 : 0);
  }

  main().catch((error) => {
    console.log("FAIL  e2e harness could not start");
    console.log(`      ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
    process.exit(1);
  });
}

runTests();
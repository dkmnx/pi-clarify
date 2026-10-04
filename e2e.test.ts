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
import type { ExtensionUIContext } from "@earendil-works/pi-coding-agent";

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

      const emit = async (prompt: string, options: Record<string, unknown> = {}) => {
        const result = await runner.emitBeforeAgentStart(prompt, undefined, {
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
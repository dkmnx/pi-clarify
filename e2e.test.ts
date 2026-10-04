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
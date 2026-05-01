/**
 * Unit tests for clarify extension helpers
 */

import {
  CLARIFY_PROMPT,
  CLARIFY_GUIDELINES,
  buildClarifyAgentStartResult,
  shouldBypassClarify,
  stripClarifyBypassPrefix,
  isVagueInput,
} from "./clarify-utils";

interface TestCase {
  name: string;
  run: () => void | Promise<void>;
}

function runTests() {
  let passed = 0;
  let failed = 0;

  const tests: TestCase[] = [
    {
      name: "CLARIFY_PROMPT contains key evaluation criteria",
      run: () => {
        if (!CLARIFY_PROMPT.includes("MANDATORY")) {
          throw new Error("Expected prompt to include the mandatory clarify rule");
        }
        if (!CLARIFY_PROMPT.includes("clarify_prompt")) {
          throw new Error("Expected prompt to mention clarify_prompt tool");
        }
        if (!CLARIFY_PROMPT.toLowerCase().includes("at least 3")) {
          throw new Error("Expected prompt to require at least 3 options");
        }
      },
    },
    {
      name: "CLARIFY_GUIDELINES has instruction bullets",
      run: () => {
        if (CLARIFY_GUIDELINES.length === 0) {
          throw new Error("Expected at least one guideline");
        }
        const hasVagueDetection = CLARIFY_GUIDELINES.some(
          (g) => g.toLowerCase().includes("vague") || g.toLowerCase().includes("ambiguous"),
        );
        if (!hasVagueDetection) {
          throw new Error("Expected guideline about vague prompt detection");
        }
      },
    },
    {
      name: "buildClarifyAgentStartResult: returns systemPrompt injection when enabled",
      run: () => {
        const systemPrompt = "Base system prompt";
        const result = buildClarifyAgentStartResult({
          enabled: true,
          bypassForThisTurn: false,
          systemPrompt,
          isVague: false,
        });

        if (!result) {
          throw new Error("Expected result when enabled");
        }
        if (!result.systemPrompt.includes("Base system prompt")) {
          throw new Error("Expected result to include base system prompt");
        }
        if (!result.systemPrompt.includes(CLARIFY_PROMPT)) {
          throw new Error("Expected result systemPrompt to include CLARIFY_PROMPT");
        }
      },
    },
    {
      name: "buildClarifyAgentStartResult: returns null when disabled",
      run: () => {
        const result = buildClarifyAgentStartResult({
          enabled: false,
          bypassForThisTurn: false,
          systemPrompt: "Base",
          isVague: false,
        });
        if (result !== null) {
          throw new Error("Expected null when disabled");
        }
      },
    },
    {
      name: "buildClarifyAgentStartResult: returns null when bypassed for this turn",
      run: () => {
        const result = buildClarifyAgentStartResult({
          enabled: true,
          bypassForThisTurn: true,
          systemPrompt: "Base",
          isVague: false,
        });
        if (result !== null) {
          throw new Error("Expected null when bypassed");
        }
      },
    },
    {
      name: "buildClarifyAgentStartResult: injects reminder message for vague inputs",
      run: () => {
        const result = buildClarifyAgentStartResult({
          enabled: true,
          bypassForThisTurn: false,
          systemPrompt: "Base",
          isVague: true,
        });

        if (!result) {
          throw new Error("Expected result when enabled");
        }
        if (!result.message) {
          throw new Error("Expected message injection for vague input");
        }
        if (result.message.customType !== "clarify-reminder") {
          throw new Error("Expected customType to be 'clarify-reminder'");
        }
        if (result.message.display !== false) {
          throw new Error("Expected message to be hidden from user");
        }
      },
    },
    {
      name: "buildClarifyAgentStartResult: no message for non-vague inputs",
      run: () => {
        const result = buildClarifyAgentStartResult({
          enabled: true,
          bypassForThisTurn: false,
          systemPrompt: "Base",
          isVague: false,
        });

        if (!result) {
          throw new Error("Expected result when enabled");
        }
        if (result.message) {
          throw new Error("Expected no message injection for clear input");
        }
      },
    },
    {
      name: "shouldBypassClarify: detects ! prefix",
      run: () => {
        if (!shouldBypassClarify("!fix it")) {
          throw new Error("Expected !fix it to trigger bypass");
        }
        if (!shouldBypassClarify("! fix it")) {
          throw new Error("Expected ! fix it to trigger bypass");
        }
        if (shouldBypassClarify("fix it")) {
          throw new Error("Expected fix it to NOT trigger bypass");
        }
        if (shouldBypassClarify("what!")) {
          throw new Error("Expected what! to NOT trigger bypass (not at start)");
        }
      },
    },
    {
      name: "shouldBypassClarify: handles empty/whitespace",
      run: () => {
        if (shouldBypassClarify("")) {
          throw new Error("Expected empty string to NOT trigger bypass");
        }
        if (shouldBypassClarify("   ")) {
          throw new Error("Expected whitespace to NOT trigger bypass");
        }
      },
    },
    {
      name: "stripClarifyBypassPrefix removes leading ! only",
      run: () => {
        if (stripClarifyBypassPrefix("!fix it") !== "fix it") {
          throw new Error("Expected leading ! to be stripped");
        }
        if (stripClarifyBypassPrefix("   ! fix it") !== "fix it") {
          throw new Error("Expected leading whitespace and ! to be stripped");
        }
        if (stripClarifyBypassPrefix("fix it") !== "fix it") {
          throw new Error("Expected non-bypassed text to stay unchanged");
        }
      },
    },
    // isVagueInput tests
    {
      name: "isVagueInput: short inputs are vague",
      run: () => {
        if (!isVagueInput("fix it")) throw new Error("Expected 'fix it' to be vague");
        if (!isVagueInput("what?")) throw new Error("Expected 'what?' to be vague");
        if (!isVagueInput("ok")) throw new Error("Expected 'ok' to be vague");
        if (!isVagueInput("x")) throw new Error("Expected 'x' to be vague");
        if (isVagueInput("Add user authentication with login and signup endpoints")) {
          throw new Error("Expected detailed prompt to NOT be vague");
        }
      },
    },
    {
      name: "isVagueInput: ambiguous referents are vague",
      run: () => {
        const cases = [
          "fix it",
          "this is broken",
          "the bug",
          "the issue",
          "the problem",
          "that thing",
          "optimize this",
          "refactor that",
          "update the config",
          "improve it",
          "do it",
          "make it work",
          "handle it",
        ];
        for (const text of cases) {
          if (!isVagueInput(text)) {
            throw new Error(`Expected '${text}' to be vague`);
          }
        }
      },
    },
    {
      name: "isVagueInput: unclear outcomes are vague",
      run: () => {
        const cases = [
          "make it better",
          "improve the code",
          "clean this up",
          "optimize this",
          "enhance it",
          "should be better",
          "needs to be faster",
        ];
        for (const text of cases) {
          if (!isVagueInput(text)) {
            throw new Error(`Expected '${text}' to be vague`);
          }
        }
      },
    },
    {
      name: "isVagueInput: undefined scope is vague",
      run: () => {
        const cases = [
          "refactor everything",
          "fix all",
          "update all",
          "change everything",
          "fix the tests",
          "update the tests",
          "check the tests",
        ];
        for (const text of cases) {
          if (!isVagueInput(text)) {
            throw new Error(`Expected '${text}' to be vague`);
          }
        }
      },
    },
    {
      name: "isVagueInput: missing constraints are vague",
      run: () => {
        const cases = [
          "just fix it",
          "simply update it",
          "quickly change",
          "just refactor",
        ];
        for (const text of cases) {
          if (!isVagueInput(text)) {
            throw new Error(`Expected '${text}' to be vague`);
          }
        }
      },
    },
    {
      name: "isVagueInput: generic single-word requests are vague",
      run: () => {
        const cases = ["fix", "update", "refactor", "improve", "optimize", "clean", "check", "review"];
        for (const text of cases) {
          if (!isVagueInput(text)) {
            throw new Error(`Expected '${text}' to be vague`);
          }
        }
      },
    },
    {
      name: "isVagueInput: clear detailed prompts are not vague",
      run: () => {
        const cases = [
          "Add user authentication with login and signup endpoints using JWT",
          "Fix the login redirect issue when user visits /dashboard without auth",
          "Optimize the database query in src/api/users.ts that fetches all users",
          "Refactor the UserService class to extract validation logic",
          "Update package.json to add the latest version of lodash",
          "Clean up unused imports in src/components/Button.tsx",
          "Check if the API key is valid by calling /health endpoint",
          "Review the error handling in the auth middleware",
        ];
        for (const text of cases) {
          if (isVagueInput(text)) {
            throw new Error(`Expected '${text.substring(0, 30)}...' to NOT be vague`);
          }
        }
      },
    },
  ];

  console.log("Running clarify extension tests...\n");

  for (const test of tests) {
    try {
      test.run();
      console.log(`✓ ${test.name}`);
      passed++;
    } catch (error) {
      console.log(`✗ ${test.name}`);
      console.log(`  ${error instanceof Error ? error.message : String(error)}`);
      failed++;
    }
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();

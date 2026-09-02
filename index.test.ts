/**
 * Unit tests for clarify extension helpers
 */

import {
  CLARIFY_PROMPT,
  CLARIFY_GUIDELINES,
  NETWORK_ISSUE_PROMPT,
  buildClarifyAgentStartResult,
  buildNetworkReminderResult,
  isNetworkIssueResult,
  shouldBypassClarify,
  stripClarifyBypassPrefix,
  isVagueInput,
} from "./clarify-utils.ts";

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
      name: "shouldBypassClarify: detects ~ prefix",
      run: () => {
        if (!shouldBypassClarify("~fix it")) {
          throw new Error("Expected ~fix it to trigger bypass");
        }
        if (!shouldBypassClarify("~ fix it")) {
          throw new Error("Expected ~ fix it to trigger bypass");
        }
        if (shouldBypassClarify("fix it")) {
          throw new Error("Expected fix it to NOT trigger bypass");
        }
        if (shouldBypassClarify("what~")) {
          throw new Error("Expected what~ to NOT trigger bypass (not at start)");
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
      name: "stripClarifyBypassPrefix removes leading ~ only",
      run: () => {
        if (stripClarifyBypassPrefix("~fix it") !== "fix it") {
          throw new Error("Expected leading ~ to be stripped");
        }
        if (stripClarifyBypassPrefix("   ~ fix it") !== "fix it") {
          throw new Error("Expected leading whitespace and ~ to be stripped");
        }
        if (stripClarifyBypassPrefix("fix it") !== "fix it") {
          throw new Error("Expected non-bypassed text to stay unchanged");
        }
      },
    },
    // isVagueInput tests
    {
      name: "isVagueInput: empty or whitespace is vague",
      run: () => {
        if (!isVagueInput("")) throw new Error("Expected '' to be vague");
        if (!isVagueInput("   ")) throw new Error("Expected whitespace to be vague");
      },
    },
    {
      name: "isVagueInput: single character is vague",
      run: () => {
        if (!isVagueInput("x")) throw new Error("Expected 'x' to be vague");
        if (!isVagueInput("?")) throw new Error("Expected '?' to be vague");
      },
    },
    {
      name: "isVagueInput: pure punctuation is vague",
      run: () => {
        const cases = ["?", "!", "?!", "...", "……"];
        for (const text of cases) {
          if (!isVagueInput(text)) {
            throw new Error(`Expected '${text}' to be vague`);
          }
        }
      },
    },
    {
      name: "isVagueInput: short but actionable inputs are not auto-flagged",
      run: () => {
        const cases = [
          "yes",
          "ok",
          "git push",
          "npm test",
          "cargo build",
          "what?",
          "fix it",
          "refactor everything",
          "make it better",
        ];
        for (const text of cases) {
          if (isVagueInput(text)) {
            throw new Error(`Expected '${text}' to NOT be vague`);
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
    {
      name: "NETWORK_ISSUE_PROMPT contains key rules",
      run: () => {
        if (!NETWORK_ISSUE_PROMPT.includes("Do NOT silently retry")) {
          throw new Error("Expected prompt to forbid silent retries");
        }
        if (!NETWORK_ISSUE_PROMPT.includes("clarify_prompt")) {
          throw new Error("Expected prompt to mention clarify_prompt tool");
        }
        if (!NETWORK_ISSUE_PROMPT.includes("Switch to a different proxy")) {
          throw new Error("Expected prompt to suggest proxy/network options");
        }
      },
    },
    {
      name: "isNetworkIssueResult: detects common network/proxy/rate-limit errors",
      run: () => {
        const cases = [
          "curl: (28) Operation timed out",
          "fetch failed: connect ECONNREFUSED 127.0.0.1:8080",
          "getaddrinfo ENOTFOUND api.example.com",
          "Error: socket hang up",
          "ProxyError: bad gateway",
          "429 Too Many Requests",
          "quota exceeded",
          "请求超时",
          "代理连接失败",
          "SSL certificate verify failed",
          "ETIMEDOUT",
          "HTTP 502 Bad Gateway",
          "503 Service Unavailable",
        ];
        for (const text of cases) {
          if (!isNetworkIssueResult({ isError: true, content: [{ type: "text", text }] })) {
            throw new Error(`Expected '${text}' to be detected as network issue`);
          }
        }
      },
    },
    {
      name: "isNetworkIssueResult: ignores non-error results",
      run: () => {
        const result = isNetworkIssueResult({
          isError: false,
          content: [{ type: "text", text: "curl: (28) Operation timed out" }],
        });
        if (result) {
          throw new Error("Expected non-error result NOT to be flagged");
        }
      },
    },
    {
      name: "isNetworkIssueResult: ignores unrelated errors",
      run: () => {
        const cases = [
          "SyntaxError: unexpected token",
          "file not found: /tmp/missing.ts",
          "Command failed: npm install (exit code 1)",
          "TypeError: Cannot read properties of undefined",
        ];
        for (const text of cases) {
          if (isNetworkIssueResult({ isError: true, content: [{ type: "text", text }] })) {
            throw new Error(`Expected '${text}' NOT to be flagged`);
          }
        }
      },
    },
    {
      name: "buildClarifyAgentStartResult: injects NETWORK_ISSUE_PROMPT alongside CLARIFY_PROMPT",
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
        if (!result.systemPrompt.includes(CLARIFY_PROMPT)) {
          throw new Error("Expected systemPrompt to include CLARIFY_PROMPT");
        }
        if (!result.systemPrompt.includes(NETWORK_ISSUE_PROMPT)) {
          throw new Error("Expected systemPrompt to include NETWORK_ISSUE_PROMPT");
        }
      },
    },
    {
      name: "buildNetworkReminderResult appends reminder to content",
      run: () => {
        const content = [{ type: "text", text: "original output" }];
        const patch = buildNetworkReminderResult({ content });
        if (patch.content.length !== 2) {
          throw new Error("Expected reminder to be appended");
        }
        if (patch.content[0].text !== "original output") {
          throw new Error("Expected original content to be preserved");
        }
        if (!patch.content[1].text.includes("NETWORK/PROXY ISSUE DETECTED")) {
          throw new Error("Expected reminder text to be appended");
        }
      },
    },
    {
      name: "buildNetworkReminderResult handles empty content",
      run: () => {
        const patch = buildNetworkReminderResult({ content: undefined });
        if (patch.content.length !== 1) {
          throw new Error("Expected exactly one reminder entry");
        }
      },
    },
    {
      name: "isNetworkIssueResult: handles string and undefined content",
      run: () => {
        if (!isNetworkIssueResult({ isError: true, content: "ECONNREFUSED direct string" })) {
          throw new Error("Expected string content to be detected");
        }
        if (isNetworkIssueResult({ isError: true, content: undefined })) {
          throw new Error("Expected undefined content NOT to be flagged");
        }
        if (isNetworkIssueResult({ isError: true, content: null as unknown as string })) {
          throw new Error("Expected null content NOT to be flagged");
        }
        if (isNetworkIssueResult({ isError: true, content: [] })) {
          throw new Error("Expected empty array NOT to be flagged");
        }
      },
    },
    {
      name: "isNetworkIssueResult: ignores image-only content without text",
      run: () => {
        const result = isNetworkIssueResult({
          isError: true,
          content: [{ type: "image", data: "aGVsbG8=" }],
        });
        if (result) {
          throw new Error("Expected image-only content NOT to be flagged");
        }
        const mixed = isNetworkIssueResult({
          isError: true,
          content: [
            { type: "image", data: "xxx" },
            { type: "text", text: "proxy error" },
          ],
        });
        if (!mixed) {
          throw new Error("Expected mixed image+text with proxy to be flagged");
        }
      },
    },
    {
      name: "isNetworkIssueResult: word boundaries for status codes and SSL",
      run: () => {
        const shouldNotFlag = ["line 1429", "error a502b", "xSSLx error", "14294"];
        for (const text of shouldNotFlag) {
          if (isNetworkIssueResult({ isError: true, content: [{ type: "text", text }] })) {
            throw new Error(`Expected '${text}' NOT to be flagged (boundary)`);
          }
        }
        const shouldFlag = ["429 Too Many Requests", "Error 502", "SSL certificate failed"];
        for (const text of shouldFlag) {
          if (!isNetworkIssueResult({ isError: true, content: [{ type: "text", text }] })) {
            throw new Error(`Expected '${text}' to be flagged`);
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

/**
 * Unit tests for clarify extension helpers
 */

import {
  CLARIFY_PROMPT,
  CLARIFY_GUIDELINES,
  CLARIFY_SECTION_NAME,
  CLARIFY_TOOL_NAME,
  NETWORK_ISSUE_PROMPT,
  assertPromptSectionsSupported,
  buildClarifyAgentStartResult,
  isNetworkIssueResult,
  shouldBypassClarify,
  stripClarifyBypassPrefix,
  isVagueInput,
} from "./clarify-utils.ts";

/** Mirrors pi's NormalizedBuildSystemPromptOptions, the mutable object a
 * before_agent_start handler receives and edits in place. */
function promptOptions(selectedTools?: string[]) {
  return {
    selectedTools: selectedTools ?? ["read", "clarify_prompt"],
    toolSnippets: {},
    toolGuidelines: {},
    promptGuidelines: [],
    appendSystemPrompt: "",
    sections: {} as Record<string, string>,
    contextFiles: [],
    skills: [],
    cwd: ".",
  };
}

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
      name: "buildClarifyAgentStartResult: writes instructions into a prompt section",
      run: () => {
        const options = promptOptions();
        const result = buildClarifyAgentStartResult({
          enabled: true,
          bypassForThisTurn: false,
          systemPromptOptions: options,
          isVague: false,
        });

        if (!result) {
          throw new Error("Expected result when enabled");
        }
        const section = options.sections[CLARIFY_SECTION_NAME];
        if (!section) {
          throw new Error(`Expected a '${CLARIFY_SECTION_NAME}' prompt section to be written`);
        }
        if (!section.includes(CLARIFY_PROMPT)) {
          throw new Error("Expected section to include CLARIFY_PROMPT");
        }
        if (!section.includes(NETWORK_ISSUE_PROMPT)) {
          throw new Error("Expected section to include NETWORK_ISSUE_PROMPT");
        }
      },
    },
    {
      name: "buildClarifyAgentStartResult: never returns systemPrompt, which would drop sections",
      run: () => {
        const options = promptOptions();
        const result = buildClarifyAgentStartResult({
          enabled: true,
          bypassForThisTurn: false,
          systemPromptOptions: options,
          isVague: false,
        });

        if (!result) {
          throw new Error("Expected result when enabled");
        }
        if ("systemPrompt" in result) {
          throw new Error(
            "Returning systemPrompt sets pi's forceSystemPrompt, which makes buildSystemPromptState drop all structured sections",
          );
        }
      },
    },
    {
      name: "buildClarifyAgentStartResult: leaves other sections untouched",
      run: () => {
        const options = promptOptions();
        options.sections.other_extension = "<other>keep me</other>";
        buildClarifyAgentStartResult({
          enabled: true,
          bypassForThisTurn: false,
          systemPromptOptions: options,
          isVague: false,
        });

        if (options.sections.other_extension !== "<other>keep me</other>") {
          throw new Error("Expected other extensions' sections to survive");
        }
      },
    },
    {
      name: "buildClarifyAgentStartResult: returns null when disabled",
      run: () => {
        const options = promptOptions();
        const result = buildClarifyAgentStartResult({
          enabled: false,
          bypassForThisTurn: false,
          systemPromptOptions: options,
          isVague: false,
        });
        if (result !== null) {
          throw new Error("Expected null when disabled");
        }
        if (CLARIFY_SECTION_NAME in options.sections) {
          throw new Error("Expected no section written when disabled");
        }
      },
    },
    {
      name: "buildClarifyAgentStartResult: returns null when bypassed for this turn",
      run: () => {
        const options = promptOptions();
        const result = buildClarifyAgentStartResult({
          enabled: true,
          bypassForThisTurn: true,
          systemPromptOptions: options,
          isVague: false,
        });
        if (result !== null) {
          throw new Error("Expected null when bypassed");
        }
        if (CLARIFY_SECTION_NAME in options.sections) {
          throw new Error("Expected no section written when bypassed");
        }
      },
    },
    {
      name: "buildClarifyAgentStartResult: skips injection when clarify_prompt is not in the active tool set",
      run: () => {
        const options = promptOptions(["read", "bash"]);
        const result = buildClarifyAgentStartResult({
          enabled: true,
          bypassForThisTurn: false,
          systemPromptOptions: options,
          isVague: false,
        });
        if (result !== null) {
          throw new Error("Expected null when clarify_prompt is not active");
        }
        if (CLARIFY_SECTION_NAME in options.sections) {
          throw new Error("Expected no section when the tool is inactive");
        }
      },
    },
    {
      name: "buildClarifyAgentStartResult: injects reminder message for vague inputs",
      run: () => {
        const result = buildClarifyAgentStartResult({
          enabled: true,
          bypassForThisTurn: false,
          systemPromptOptions: promptOptions(),
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
          systemPromptOptions: promptOptions(),
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
    {
      name: "shouldBypassClarify: leaves home-relative paths alone",
      run: () => {
        // pi's own footer renders cwd as ~/Documents/..., so prompts starting with
        // "~/..." are routine. Treating them as a bypass corrupts the path.
        for (const p of ["~/project", "~/.bashrc", "~/", "~user/foo", "  ~/notes.md"]) {
          if (shouldBypassClarify(p)) {
            throw new Error(`Expected '${p}' to NOT trigger bypass`);
          }
          const stripped = stripClarifyBypassPrefix(p);
          if (stripped !== p) {
            throw new Error(`Expected '${p}' to survive intact, got '${stripped}'`);
          }
        }
        // Windows separator: pi's own footer renders the cwd as ~\Documents\...
        const win = "~\\Documents\\cli\\notes.md please summarize";
        if (shouldBypassClarify(win)) {
          throw new Error("Expected a backslash path to NOT trigger bypass");
        }
        if (stripClarifyBypassPrefix(win) !== win) {
          throw new Error(`Expected the backslash path intact, got '${stripClarifyBypassPrefix(win)}'`);
        }
      },
    },
    {
      name: "stripClarifyBypassPrefix still works for the standalone marker",
      run: () => {
        if (stripClarifyBypassPrefix("~fix it") !== "fix it") {
          throw new Error("Expected '~fix it' to strip");
        }
        if (stripClarifyBypassPrefix("~ fix it") !== "fix it") {
          throw new Error("Expected '~ fix it' to strip");
        }
        if (stripClarifyBypassPrefix("~") !== "") {
          throw new Error("Expected a bare '~' to strip to empty");
        }
      },
    },
    {
      name: "assertPromptSectionsSupported: passes on a host that provides sections",
      run: () => {
        assertPromptSectionsSupported({ sections: {} });
      },
    },
    {
      name: "assertPromptSectionsSupported: names the required pi version on an older host",
      run: () => {
        let thrown = "";
        try {
          assertPromptSectionsSupported({});
        } catch (error) {
          thrown = error instanceof Error ? error.message : String(error);
        }
        if (!thrown) {
          throw new Error("Expected a throw when the host exposes no prompt sections");
        }
        if (!thrown.includes("1.0.0")) {
          throw new Error(`Expected the message to name the required version, got: ${thrown}`);
        }
        if (!thrown.includes("pi-clarify")) {
          throw new Error(`Expected the message to name the extension, got: ${thrown}`);
        }
      },
    },
    {
      name: "buildClarifyAgentStartResult names the required pi version when the host has no sections",
      run: () => {
        let thrown = "";
        try {
          buildClarifyAgentStartResult({
            enabled: true,
            bypassForThisTurn: false,
            systemPromptOptions: { selectedTools: ["clarify_prompt"] },
            isVague: false,
          });
        } catch (error) {
          thrown = error instanceof Error ? error.message : String(error);
        }
        if (!thrown.includes("pi-clarify") || !thrown.includes("1.0.0")) {
          throw new Error(`Expected a throw naming the extension and version, got: ${thrown || "no throw"}`);
        }
      },
    },
    {
      name: "buildClarifyAgentStartResult stays quiet on an old host when disabled or bypassed",
      run: () => {
        const options = { selectedTools: ["clarify_prompt"] };
        const disabled = buildClarifyAgentStartResult({
          enabled: false,
          bypassForThisTurn: false,
          systemPromptOptions: options,
          isVague: false,
        });
        const bypassed = buildClarifyAgentStartResult({
          enabled: true,
          bypassForThisTurn: true,
          systemPromptOptions: options,
          isVague: false,
        });
        if (disabled !== null || bypassed !== null) {
          throw new Error("Expected no result, and no capability error, when nothing needs injecting");
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
          "API quota exceeded for model gpt-4",
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
      name: "isNetworkIssueResult: ignores non-network errors that share vocabulary",
      run: () => {
        const notNetwork = [
          "SyntaxError: Unexpected token } at position 429",
          "assertion failed: timeout value 500 must be < 300",
          "error: cannot find module 'proxy-handler'",
          "ReferenceError: network is not defined",
          "src/api.ts:502: export const handler = 1",
          "no-unreachable: Unreachable 'return' statement",
          "OSError: Disk quota exceeded",
          "Error: expected 3 arguments, got 2",
          "TypeError: rateLimit is not a function",
          "x-ratelimit-remaining: 0",
          "src/cache.ts:12 error TS2304: Cannot find name 'rateLimit'.",
          "webpack compiled with 1 error in 500 ms",
          "process exited with error code 500",
          "Error: expected 500 items, see error above",
          "  429 passing (12ms)",
          "jest: test timed out after 5000ms",
          "  3 tests timed out",
          "Error: 500 units of currency, service tier gold",
          "AssertionError: timeout of 5000ms exceeded",
        ];
        for (const text of notNetwork) {
          if (isNetworkIssueResult({ isError: true, content: [{ type: "text", text }] })) {
            throw new Error(`Expected a non-network error to NOT be flagged: ${text}`);
          }
        }
      },
    },
    {
      name: "isNetworkIssueResult: catches common real connectivity failures",
      run: () => {
        const network = [
          "TypeError: fetch failed",
          "curl: (6) Could not resolve host: example.com",
          "curl: (52) Empty reply from server",
          "connect: connection refused",
          '{"error":{"code":"rate_limit_exceeded"}}',
          "dial tcp: i/o timeout",
          "TLS handshake failed",
          "Temporary failure in name resolution",
          "getaddrinfo ENOTFOUND api.example.com",
          "socket hang up",
          "status code 503",
          "ECONNREFUSED 127.0.0.1:8080",
          "429",
          "503",
          "You exceeded your current quota, please check your plan and billing details.",
          "overloaded_error",
          "Azure deployment failed with status 'TooManyRequests'.",
          "net::ERR_INTERNET_DISCONNECTED",
          "systemd-resolved: DNS resolution failed for api.example.com",
          "upstream connect error or disconnect/reset before headers",
          "Rate limit exceeded for org",
          "rate_limit_exceeded",
          "No such host is known. (Name or service not known)",
          "The operation was canceled due to timeout",
          "npm ERR! network request to https://registry.example.com failed",
          "net::ERR_TUNNEL_CONNECTION_FAILED",
          "EPROTO: Protocol error",
          "gRPC: 14 UNAVAILABLE: No connection established",
          "HTTP/1.1 502 Bad Gateway",
          "Error 502",
        ];
        for (const text of network) {
          if (!isNetworkIssueResult({ isError: true, content: [{ type: "text", text }] })) {
            throw new Error(`Expected a network failure to be flagged: ${text}`);
          }
        }
      },
    },
    {
      name: "isNetworkIssueResult stays linear on long single-line payloads",
      run: () => {
        // An unbounded lookahead per status-code hit made this quadratic. The
        // status-shaped numbers must genuinely match the lookahead source (`\b429\b`
        // needs its word boundary, and must not sit at the start of the line where an
        // earlier source would match and short-circuit), and no status word may
        // follow, so the whole line gets traversed.
        const line = ("x 429 " + "a".repeat(20) + " ").repeat(8000);
        const started = process.hrtime.bigint();
        isNetworkIssueResult({ isError: true, content: [{ type: "text", text: line }] });
        const ms = Number(process.hrtime.bigint() - started) / 1e6;
        // Measured on this payload: the bounded lookahead takes 6-9ms, the unbounded
        // one ~970ms. 300ms leaves ample room for a slow machine while still
        // catching the regression.
        if (ms > 300) {
          throw new Error(
            `Expected linear matching on a ${Math.round(line.length / 1024)}KB line, took ${Math.round(ms)}ms`,
          );
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

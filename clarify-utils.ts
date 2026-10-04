/** Exported for testing: the tool name pi-clarify registers and references in prompts. */
export const CLARIFY_TOOL_NAME = "clarify_prompt";

/** Exported for testing: the prompt section pi renders as `<clarify>...</clarify>`.
 *
 * pi's before_agent_start contract exposes systemPromptOptions as mutable prompt
 * sections, and the transcript records a section delta. Returning `systemPrompt`
 * instead would set forceSystemPrompt, which makes pi's buildSystemPromptState drop
 * every structured section and replace the prompt wholesale. */
export const CLARIFY_SECTION_NAME = "clarify";

/** Exported for testing: the clarification instructions carried in the `clarify` section */
export const CLARIFY_PROMPT = `╔══════════════════════════════════════════════════════════════════════════════╗
║  MANDATORY: CLARIFY_PROMPT TOOL USAGE                                          ║
╚══════════════════════════════════════════════════════════════════════════════╝

YOU MUST CALL THE \`clarify_prompt\` TOOL BEFORE RESPONDING when:

1. Ambiguous referents — User says "fix it", "this is broken", "the bug", "optimize this", "refactor that", "update the config"
2. Unclear outcomes — "make it better", "clean this up", "improve the code" (what does "better" mean specifically?)
3. Undefined scope — "refactor everything", "fix the tests" (which files? how many?)
4. Missing constraints — No mention of backwards compatibility, performance priorities, or approach preferences
5. Multiple valid interpretations — You can reasonably understand the request in 2+ different ways
6. Very short requests — Extremely brief prompts may lack context, but do not clarify solely because of length. Consider conversation history and whether the request is actionable as written.

DO NOT ask for clarification in your response text.
DO NOT say "I need more details."
DO NOT explain what's unclear.
DO NOT proceed with any action until clarification is received.

INSTEAD: Call \`clarify_prompt\` with:
    - question: A focused, one-sentence question
    - options: At least 3 specific options, plus "Your answer..."

Wait for the tool result. You may call \`clarify_prompt\` multiple times for different unclear aspects.`;

/** Exported for testing: network/proxy issue instructions appended to system prompt */
export const NETWORK_ISSUE_PROMPT = `╔══════════════════════════════════════════════════════════════════════════════╗
║  NETWORK / PROXY ISSUE HANDLING                                               ║
╚══════════════════════════════════════════════════════════════════════════════╝

When a tool call fails with a network, proxy, connectivity, or rate-limit error
(timeout, ECONNREFUSED, ENOTFOUND, ETIMEDOUT, ECONNRESET, proxy error, 429, 502,
503, 504, quota exceeded, certificate issues, etc.):

1. Do NOT silently retry more than once.
2. Do NOT silently switch to an alternative approach or tool.
3. STOP and call the \`clarify_prompt\` tool to ask the user how they want to
   proceed. Provide concrete options such as:
   - "Retry the same request"
   - "Switch to a different proxy / network"
   - "Wait and try again later"
   - "Use a fallback approach / different tool"
   - "Skip this step and continue"
4. Wait for the user's choice before continuing.`;

/** Exported for testing: regex matching network/proxy/rate-limit error signatures.
 *
 * Bare words are deliberately absent. `timeout`, `network`, `proxy`, `unreachable`,
 * `quota` and the HTTP status codes all occur constantly in unrelated failures --
 * `timeout value 500`, `src/api.ts:502`, `network is not defined` -- and matching
 * them makes the agent abandon real work to ask about a network problem that never
 * happened. Each source below therefore carries the context that makes it a
 * connectivity or rate-limit signal rather than a shared word. */
const NETWORK_ERROR_SOURCES: RegExp[] = [
  // errno, libuv and Chromium socket codes: unambiguous on their own.
  /\b(?:ECONNREFUSED|ECONNRESET|ECONNABORTED|ENOTFOUND|ETIMEDOUT|EPIPE|EPROTO|EHOSTUNREACH|EHOSTDOWN|ENETUNREACH|ENETDOWN|EAI_AGAIN|EAI_NONAME|EAI_FAIL)\b/,
  /\bERR_(?:INTERNET_DISCONNECTED|NETWORK_CHANGED|NAME_NOT_RESOLVED|CONNECTION_[A-Z_]+|ADDRESS_[A-Z_]+|TUNNEL_[A-Z_]+|PROXY_[A-Z_]+|SOCKS_[A-Z_]+)\b/,
  // Name resolution. `curl: (6)` is curl's DNS failure code. Windows reports a
  // failed lookup as prose rather than an errno, and that spelling is the common one
  // there, so it counts too.
  /getaddrinfo/,
  /\b(?:no such host is known|name or service not known)\b/i,
  /(?:could not|cannot|can't|failed to|unable to)\s+(?:resolve|look up)\s+(?:host|name)/,
  /\b(?:DNS|name) resolution\b/,
  /\bDNS_PROBE_FINISHED_NXDOMAIN\b/,
  /curl:\s*\(\s*(?:6|7|18|28|35|52|55|56|60)\s*\)/,
  // Transport and reachability.
  /fetch failed/,
  /socket hang up/,
  /\bconnection (?:refused|reset|closed|aborted|timed out)\b/,
  /\bnetwork (?:is unreachable|error|failure|problem|issue|timeout)\b/,
  /\bno route to host\b/,
  /\bi\/o timeout\b/,
  /(?:unable to connect|failed to connect|could not connect)/,
  /upstream connect error/,
  /disconnect\/reset before headers/,
  // gRPC reports transport failure as an availability status.
  /\bunavailable\b[^\n]{0,24}\b(?:no connection|connectivity|refused|unreachable|established)\b/i,
  /\bnetwork request\b[^\n]{0,60}\bfailed\b/i,
  // TLS and certificates.
  /\bTLS\b|\bSSL\b|handshake (?:failed|error)|certificate/i,
  // A proxy error needs its own word so `cannot find module 'proxy-handler'` and
  // other files named after proxies do not match.
  /\bproxy (?:error|failure|failed|unreachable|refused)\b/i,
  // Rate limiting. `rate limit` alone is far too weak on its own: `rateLimit is
  // not a function` and `x-ratelimit-remaining: 0` both contain it, so it has to
  // co-occur with the limit being hit.
  /rate[ _-]?limit[^\n]{0,16}(?:exceed|reached|hit)/i,
  /too[ _-]?many[ _-]?requests/i,
  /\boverloaded_error\b/i,
  // `Disk quota exceeded` and `API quota exceeded` differ only in the words around
  // them, so quota counts only next to an API, billing or usage term.
  /\b(?:api|key|token|model|billing|plan|usage|request|account|credit)[^\n]{0,40}\bquota\b|\bquota\b[^\n]{0,40}\b(?:api|key|token|model|billing|plan|usage|request|account|credit)\b/i,
  // A bare HTTP status counts only when the line is essentially just a status, or is
  // introduced by an explicit status word. Everywhere else `at position 429`,
  // `api.ts:502` and `1 error in 500 ms` are indistinguishable from a real status,
  // and flagging those aborts real work over a phantom network problem. Every
  // lookahead here is bounded, so a result with thousands of status-shaped numbers
  // stays linear instead of stalling the UI.
  /^\s*(?:HTTP\/[\d.]+\s+)?[45]\d\d\b(?:\s+(?:bad|gateway|service|too|internal|upstream)\b|\s*$)/im,
  /^\s*(?:error|err)\s*:?\s*[45]\d\d\b(?:\s+(?:bad|gateway|service|too|internal|upstream)\b|\s*$)/im,
  /\b(?:status|statuscode|status_code|http|https)\b[^\n]{0,12}\b[45]\d\d\b/i,
  /\b[45]\d\d\b(?=[^\n]{0,120}?\b(?:status|throttl|too many|overload|gateway)\b)/i,
  /bad gateway|service unavailable|gateway timeout|request timeout/i,
  // A timeout only counts when something network-shaped precedes it, so a test
  // suite reporting `test timed out` is not mistaken for a dead connection.
  /\b(?:request|connection|socket|connect|fetch|handshake|operation|dns|lookup|curl|endpoint)\b[^\n]{0,24}\b(?:timed out|timeout (?:of|exceeded|after))\b/i,
  /(?:canceled|cancelled|aborted|failed) (?:due to|after) (?:an? )?timeout/i,
  // Non-English environments.
  /代理|网络|超时|连接被拒绝/,
];

/** Exported for testing: matches any network, proxy, or rate-limit failure signature */
export const NETWORK_ERROR_PATTERN = new RegExp(
  NETWORK_ERROR_SOURCES.map((source) => `(?:${source.source})`).join("|"),
  "im",
);

/** Exported for testing: true when an errored tool result looks like a network/proxy/rate-limit failure */
export function isNetworkIssueResult(result: {
  isError?: boolean;
  content?: unknown;
}): boolean {
  if (!result.isError) return false;
  const content = result.content;
  let text = "";
  if (Array.isArray(content)) {
    const textParts = content
      .filter(
        (c): c is { type: string; text: string } =>
          !!c && typeof c === "object" && (c as { type: string }).type === "text" && typeof (c as { text: unknown }).text === "string",
      )
      .map((c) => c.text)
      .join("\n");
    text = textParts || JSON.stringify(content);
  } else if (typeof content === "string") {
    text = content;
  } else {
    text = JSON.stringify(content ?? "");
  }
  return NETWORK_ERROR_PATTERN.test(text);
}

/** Exported for testing: appended to a failed tool result when the failure looks like
 * a network, proxy or rate-limit problem. */
export const NETWORK_REMINDER_TEXT = `\n\n[NETWORK/PROXY ISSUE DETECTED] This tool failed due to a network, proxy, connectivity, or rate-limit problem. Do NOT keep retrying or switch approaches silently. Call the clarify_prompt tool and ask the user which remedy they prefer (retry / switch proxy or network / wait / fallback / skip).`;

/** Exported for testing: tool guidelines that appear in system prompt when tool is active */
export const CLARIFY_GUIDELINES = [
  "STOP: If the user prompt is vague, ambiguous, or unclear, you MUST use the clarify_prompt tool FIRST.",
  "Trigger patterns: 'fix it', 'this is broken', 'the bug', 'optimize this', 'refactor that', 'update config', 'make it better', 'clean this up'.",
  "Call clarify_prompt BEFORE any other tool or response when you detect vagueness.",
  "Parameters: { question: 'One sentence question', options: ['Option A', 'Option B', 'Option C'] } — at least 3 specific options.",
  "DO NOT ask for clarification in chat text. DO NOT say 'I need more details.' Use the tool ONLY.",
  "Wait for user selection before proceeding with any action.",
];

/** Exported for testing: result shape for before_agent_start handler.
 *
 * Carries no `systemPrompt` key on purpose: see CLARIFY_SECTION_NAME. Instructions go
 * into systemPromptOptions.sections instead, so pi records a transcript delta. */
export interface ClarifyAgentStartResult {
  message?: {
    customType: string;
    content: string;
    display: boolean;
  };
}

/** Mirrors the fields of pi's NormalizedBuildSystemPromptOptions that this module
 * reads. Declared locally because pi is a devDependency only, and the package
 * ships this file as raw TypeScript for pi to load directly. */
export interface ClarifyPromptOptions {
  selectedTools?: string[];
  sections: Record<string, string>;
}

function buildVagueReminder() {
  return {
    customType: "clarify-reminder",
    content:
      "The user's prompt appears vague or ambiguous. Use the clarify_prompt tool to get clarification before proceeding.",
    display: false,
  };
}

export function buildClarifyAgentStartResult({
  enabled,
  bypassForThisTurn,
  systemPromptOptions,
  isVague,
}: {
  enabled: boolean;
  bypassForThisTurn: boolean;
  systemPromptOptions: ClarifyPromptOptions;
  isVague: boolean;
}): ClarifyAgentStartResult | null {
  if (!enabled || bypassForThisTurn) {
    return null;
  }

  // Only inject if clarify_prompt is in the active tool set, so a session that
  // scoped the tool out never sees instructions to call it.
  if (
    systemPromptOptions.selectedTools &&
    !systemPromptOptions.selectedTools.includes(CLARIFY_TOOL_NAME)
  ) {
    return null;
  }

  // Sections render after the base prompt, so these instructions never displace
  // the base ones.
  systemPromptOptions.sections[CLARIFY_SECTION_NAME] =
    `${CLARIFY_PROMPT}\n\n${NETWORK_ISSUE_PROMPT}`;

  return isVague ? { message: buildVagueReminder() } : {};
}

/** Check if input is structurally empty and therefore unactionable */
export function isVagueInput(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length === 0) return true;
  if (trimmed.length === 1) return true;
  if (/^[?.!…]+$/.test(trimmed)) return true;
  return false;
}

/** Check if input should bypass clarify for one turn.
 *
 * Why `~` and not `!`: pi reserves `!`/`!!` as the built-in shell-command prefix
 * and short-circuits `!`-prefixed input in the interactive submit handler
 * before the `input` extension event fires — so an extension can never see it.
 * `~` is unreserved and reaches `emitInput` intact.
 *
 * The marker cannot be followed by a path. pi's own footer renders the cwd as
 * `~/…` on Unix and `~\…` on Windows, so a prompt beginning with a path is
 * routine; consuming that tilde would rewrite it to a root-relative path.
 * `~user/…` is excluded for the same reason.
 */
export function shouldBypassClarify(text: string): boolean {
  const trimmed = text.trimStart();
  return trimmed.startsWith("~") && !/^~\w*[\\/]/.test(trimmed);
}

/** Strip the one-turn bypass prefix before sending to the agent */
export function stripClarifyBypassPrefix(text: string): string {
  if (!shouldBypassClarify(text)) {
    return text;
  }
  return text.trimStart().slice(1).trimStart();
}

/** Exported for testing: the clarification instructions prepended to system prompt */
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

/** Exported for testing: regex matching network/proxy/rate-limit error signatures */
export const NETWORK_ERROR_PATTERN =
  /(network|proxy|timeout|timed out|ECONNREFUSED|ECONNRESET|ENOTFOUND|ETIMEDOUT|EHOSTUNREACH|EAI_AGAIN|socket hang up|unreachable|bad gateway|rate\s*limit|quota|\b(?:429|502|503|504)\b|超时|代理|网络|连接被拒绝|curl:\s*\(\s*(7|28|35|56|60)\s*\)|\bSSL\b|certificate)/i;

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

const NETWORK_REMINDER_TEXT = `\n\n[NETWORK/PROXY ISSUE DETECTED] This tool failed due to a network, proxy, connectivity, or rate-limit problem. Do NOT keep retrying or switch approaches silently. Call the clarify_prompt tool and ask the user which remedy they prefer (retry / switch proxy or network / wait / fallback / skip).`;

/** Exported for testing: builds a tool_result patch that appends the network reminder */
export function buildNetworkReminderResult(event: {
  content?: Array<{ type: string; text?: string } | unknown>;
}): { content: Array<{ type: "text"; text: string }> } {
  return {
    content: [
      ...((event.content ?? []) as Array<{ type: "text"; text: string }>),
      { type: "text", text: NETWORK_REMINDER_TEXT },
    ],
  };
}

/** Exported for testing: tool guidelines that appear in system prompt when tool is active */
export const CLARIFY_GUIDELINES = [
  "STOP: If the user prompt is vague, ambiguous, or unclear, you MUST use the clarify_prompt tool FIRST.",
  "Trigger patterns: 'fix it', 'this is broken', 'the bug', 'optimize this', 'refactor that', 'update config', 'make it better', 'clean this up'.",
  "Call clarify_prompt BEFORE any other tool or response when you detect vagueness.",
  "Parameters: { question: 'One sentence question', options: ['Option A', 'Option B', 'Option C'] } — at least 3 specific options.",
  "DO NOT ask for clarification in chat text. DO NOT say 'I need more details.' Use the tool ONLY.",
  "Wait for user selection before proceeding with any action.",
];

/** Exported for testing: result shape for before_agent_start handler */
export interface ClarifyAgentStartResult {
  systemPrompt: string;
  message?: {
    customType: string;
    content: string;
    display: boolean;
  };
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
  systemPrompt,
  isVague,
  systemPromptOptions,
}: {
  enabled: boolean;
  bypassForThisTurn: boolean;
  systemPrompt: string;
  isVague: boolean;
  systemPromptOptions?: { selectedTools?: string[] };
}): ClarifyAgentStartResult | null {
  if (!enabled || bypassForThisTurn) {
    return null;
  }

  // Only inject if clarify_prompt tool is in the active tool set
  // (defensive: respects tool-scoping features from pi v0.68.0+)
  if (
    systemPromptOptions?.selectedTools &&
    !systemPromptOptions.selectedTools.includes("clarify_prompt")
  ) {
    return null;
  }

  // Append after the base system prompt so critical base instructions keep
  // primacy; prepending would displace them.
  const result: ClarifyAgentStartResult = {
    systemPrompt: `${systemPrompt}\n\n${CLARIFY_PROMPT}\n\n${NETWORK_ISSUE_PROMPT}`,
  };

  if (isVague) {
    result.message = buildVagueReminder();
  }

  return result;
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
 * `~` is unreserved and reaches `emitInput` intact. */
export function shouldBypassClarify(text: string): boolean {
  return text.trimStart().startsWith("~");
}

/** Strip the one-turn bypass prefix before sending to the agent */
export function stripClarifyBypassPrefix(text: string): string {
  if (!shouldBypassClarify(text)) {
    return text;
  }
  return text.trimStart().slice(1).trimStart();
}

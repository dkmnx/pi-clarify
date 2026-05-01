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
6. Very short requests — Under 10 characters often lack necessary context

DO NOT ask for clarification in your response text.
DO NOT say "I need more details."
DO NOT explain what's unclear.
DO NOT proceed with any action until clarification is received.

INSTEAD: Call \`clarify_prompt\` with:
    - question: A focused, one-sentence question
    - options: At least 3 specific options, plus "Your answer..."

Wait for the tool result. You may call \`clarify_prompt\` multiple times for different unclear aspects.`;

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

export function buildClarifyAgentStartResult({
  enabled,
  bypassForThisTurn,
  systemPrompt,
  prompt: _prompt,
  isVague,
  systemPromptOptions,
}: {
  enabled: boolean;
  bypassForThisTurn: boolean;
  systemPrompt: string;
  prompt: string;
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

  const result: ClarifyAgentStartResult = {
    systemPrompt: `${CLARIFY_PROMPT}\n\n${systemPrompt}`,
  };

  if (isVague) {
    result.message = {
      customType: "clarify-reminder",
      content:
        "The user's prompt appears vague or ambiguous. Use the clarify_prompt tool to get clarification before proceeding.",
      display: false,
    };
  }

  return result;
}

/** Vague input patterns that should trigger clarification */
const VAGUE_PATTERNS = [
  // Ambiguous referents
  /\b(fix it|this is broken|the bug|the issue|the problem|that thing)\b/i,
  /\b(optimize|refactor|improve|update|clean up|fix)\s+(this|that|it|the code|the config|the file)\b/i,
  /\b(do it|make it work|handle it|take care of it)\b/i,
  // Unclear outcomes
  /\b(make it better|improve the code|clean this up|optimize this|enhance it)\b/i,
  /\b(should be|needs to be)\s+(better|faster|cleaner|good)\b/i,
  // Undefined scope
  /\b(refactor everything|fix all|update all|change everything)\b/i,
  /\b(fix the tests|update the tests|check the tests)\b/i,
  /\b(in the codebase|across the project|everywhere)\b/i,
  // Missing constraints
  /\b(just|simply|quickly)\s+(fix|update|change|refactor)\b/i,
  // Generic requests without specifics
  /^(fix|update|refactor|improve|optimize|clean|check|review)\s*$/i,
];

/** Check if input appears vague and needs clarification */
export function isVagueInput(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length < 10) return true;
  return VAGUE_PATTERNS.some((pattern) => pattern.test(trimmed));
}

/** Check if input should bypass clarify for one turn */
export function shouldBypassClarify(text: string): boolean {
  return text.trimStart().startsWith("!");
}

/** Strip the one-turn bypass prefix before sending to the agent */
export function stripClarifyBypassPrefix(text: string): string {
  if (!shouldBypassClarify(text)) {
    return text;
  }
  return text.trimStart().slice(1).trimStart();
}

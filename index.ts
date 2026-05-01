/**
 * Clarify Extension
 *
 * Registers a `clarify_prompt` tool that the LLM calls when it detects
 * a vague prompt. Presents the user with a select UI showing at least 3
 * suggested clarifications plus an "Other" option for freeform input.
 *
 * Toggle: /clarify on|off
 * Bypass: prefix prompt with `!` to skip clarification for one turn
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "typebox";
import { Text } from "@mariozechner/pi-tui";

import {
  isVagueInput,
  shouldBypassClarify,
  stripClarifyBypassPrefix,
  CLARIFY_GUIDELINES,
  buildClarifyAgentStartResult,
} from "./clarify-utils";

export { CLARIFY_PROMPT } from "./clarify-utils";
export { buildClarifyAgentStartResult } from "./clarify-utils";
export type { ClarifyAgentStartResult } from "./clarify-utils";

const OTHER_OPTION = "Your answer...";

function buildResponse(text: string, details: Record<string, unknown>) {
  return {
    content: [{ type: "text" as const, text }],
    details,
  };
}

function ensureOtherOption(options: string[]): string[] {
  return options.includes(OTHER_OPTION) ? options : [...options, OTHER_OPTION];
}

async function handleCustomInput(
  question: string,
  ctx: { ui: { input: (q: string, p: string) => Promise<string | undefined> } },
): Promise<string | null> {
  const custom = await ctx.ui.input(question, "");
  if (custom === undefined || custom.trim() === "") return null;
  return custom.trim();
}

export default function (pi: ExtensionAPI) {
  let enabled = true;
  let bypassNextTurn = false;
  let lastInputWasVague = false;

  pi.on("session_start", async () => {
    bypassNextTurn = false;
    lastInputWasVague = false;
  });

  pi.registerCommand("clarify", {
    description: "Toggle prompt clarification on/off",
    handler: async (args, ctx) => {
      const arg = args.trim().toLowerCase();
      if (arg === "on") {
        enabled = true;
      } else if (arg === "off") {
        enabled = false;
      } else {
        enabled = !enabled;
      }
      ctx.ui.notify(`Prompt clarification ${enabled ? "enabled" : "disabled"}`, "info");
    },
  });

  pi.on("input", async (event) => {
    if (event.source === "extension") return { action: "continue" };

    if (shouldBypassClarify(event.text)) {
      bypassNextTurn = true;
      return { action: "transform", text: stripClarifyBypassPrefix(event.text) };
    }

    lastInputWasVague = isVagueInput(event.text);

    return { action: "continue" };
  });

  pi.on("before_agent_start", async (event) => {
    const result = buildClarifyAgentStartResult({
      enabled,
      bypassForThisTurn: bypassNextTurn,
      systemPrompt: event.systemPrompt,
      isVague: lastInputWasVague,
      systemPromptOptions: (event as any).systemPromptOptions,
    });

    bypassNextTurn = false;
    lastInputWasVague = false;

    return result ?? undefined;
  });

  pi.registerTool({
    name: "clarify_prompt",
    label: "Clarify",
    description:
      "Ask the user a clarification question when their prompt is vague. Presents options for the user to pick from or type their own answer.",
    promptSnippet: "Ask the user to clarify their intent with selectable options",
    promptGuidelines: CLARIFY_GUIDELINES,
    parameters: Type.Object({
      question: Type.String({ description: "The clarification question to ask" }),
      options: Type.Array(Type.String({ description: "A suggested answer" }), {
        minItems: 3,
        description: "At least 3 concrete suggestion options",
      }),
    }),

    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      if (signal?.aborted) {
        return buildResponse("Cancelled", {});
      }

      if (!ctx.hasUI) {
        return buildResponse(
          "User prompt seems unclear: " + params.question,
          {},
        );
      }

      const selected = await ctx.ui.select(
        params.question,
        ensureOtherOption(params.options),
      );

      if (selected === undefined || selected === OTHER_OPTION) {
        if (selected === OTHER_OPTION) {
          const custom = await handleCustomInput(params.question, ctx);
          if (custom !== null) {
            return buildResponse(`User answered: ${custom}`, {
              answer: custom,
              wasOther: true,
            });
          }
        }
        ctx.abort();
        return buildResponse("User cancelled.", { skipped: true });
      }

      return buildResponse(`User answered: ${selected}`, {
        answer: selected,
        wasOther: false,
      });
    },

    renderCall(args, theme, _context) {
      let text = theme.fg("toolTitle", theme.bold("clarify_prompt "));
      text += theme.fg("muted", (args.question as string | undefined) ?? "...");
      return new Text(text, 0, 0);
    },

    renderResult(result, _options, theme, _context) {
      const details = result.details as { skipped?: boolean; answer?: string } | undefined;
      if (!details) return new Text("", 0, 0);
      if (details.skipped) {
        return new Text(theme.fg("warning", "Skipped"), 0, 0);
      }
      return new Text(theme.fg("success", details.answer ?? ""), 0, 0);
    },
  });
}

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
const TOOL_MODE_METADATA_EVENT = "mode-toggles:tool-metadata";

export default function (pi: ExtensionAPI) {
  let enabled = true;
  let bypassNextTurn = false;
  let lastInputWasVague = false;

  pi.on("session_start", async () => {
    pi.events.emit(TOOL_MODE_METADATA_EVENT, {
      toolName: "clarify_prompt",
      metadata: { readOnlySafe: true, sideEffects: "none" },
    });
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
      prompt: event.prompt,
      isVague: lastInputWasVague,
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
        return {
          content: [{ type: "text", text: "Cancelled" }],
          details: {},
        };
      }

      if (!ctx.hasUI) {
        return {
          content: [{ type: "text", text: "User prompt seems unclear: " + params.question }],
          details: {},
        };
      }

      const choices = params.options.includes(OTHER_OPTION)
        ? params.options
        : [...params.options, OTHER_OPTION];
      const selected = await ctx.ui.select(params.question, choices);

      if (selected === undefined) {
        ctx.abort();
        return {
          content: [{ type: "text", text: "User cancelled." }],
          details: { skipped: true },
        };
      }

      if (selected === OTHER_OPTION) {
        const custom = await ctx.ui.input(params.question, "");
        if (custom === undefined || custom.trim() === "") {
          ctx.abort();
          return {
            content: [{ type: "text", text: "User cancelled." }],
            details: { skipped: true },
          };
        }
        return {
          content: [{ type: "text", text: `User answered: ${custom.trim()}` }],
          details: { answer: custom.trim(), wasOther: true },
        };
      }

      return {
        content: [{ type: "text", text: `User answered: ${selected}` }],
        details: { answer: selected, wasOther: false },
      };
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

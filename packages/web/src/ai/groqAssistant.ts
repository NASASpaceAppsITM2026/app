/**
 * Groq-powered mission assistant backend.
 *
 * Talks to Groq's OpenAI-compatible chat completions endpoint
 * (`https://api.groq.com/openai/v1/chat/completions`) and translates the
 * model's structured response into a mission action result.
 *
 * Ported/integrated from the mission assistant architecture:
 * - Provider: Groq (https://groq.com) — fast inference with a generous free tier.
 * - Model: defaults to `llama-3.3-70b-versatile`, overridable via config.
 *
 * The model is asked to answer in a strict JSON contract:
 * {
 *   "reply": "...",
 *   "action": {
 *     "type": "quick_action" | "date" | "hour" | "constraints" | "none",
 *     "id": "<quick action id>",
 *     "dateUtc": "YYYY-MM-DD",
 *     "hourUtc": 0-23,
 *     "constraints": [{ "id": "...", "kind": "..." }]
 *   }
 * }
 */

import type { MissionAssistant, MissionAssistantInput, MissionActionResult } from "../aiAssistant";
import { executeQuickAction, localMissionAssistant } from "../aiAssistant";
import type { Constraint } from "core";
import { siteLabel } from "../scenario";

export const GROQ_API_BASE_URL = "https://api.groq.com/openai/v1";
/** Groq retired llama-3.3-70b-versatile for free/developer tiers on 2026-08-16. */
export const GROQ_MODEL = "openai/gpt-oss-120b";

export interface GroqAssistantConfig {
  readonly apiKey: string;
  readonly model?: string;
  readonly baseUrl?: string;
}

export interface GroqActionSpec {
  readonly reply?: string;
  readonly action?: {
    readonly type: "quick_action" | "date" | "hour" | "constraints" | "none";
    readonly id?: string;
    readonly dateUtc?: string;
    readonly hourUtc?: number;
    readonly constraints?: readonly Constraint[];
  };
}

interface GroqChatCompletionResponse {
  readonly choices?: ReadonlyArray<{
    readonly message?: { readonly content?: string };
  }>;
}

/** Build the mission-context system prompt used for every Groq chat completion. */
export function buildMissionSystemPrompt(scenario: { site: { id: string; eastLonDeg: number; latDeg: number }; dateUtc: string; hourUtc?: number; viewMode: string }): string {
  const quickIds = [
    "malapert", "shackleton", "haworth", "apollo11", "apollo12", "apollo14", "apollo15", "apollo16", "apollo17", "luna16", "luna17", "luna20",
    "summer_solstice", "plus_14d", "surface_view", "overview", "slip_scan", "area_check", "best_arrival", "score_sites",
  ];
  return [
    "You are the onboard AI mission assistant for a lunar landing site navigator.",
    "You help the astronaut operate a lunar mission planning interface around a selected landing site.",
    "Current mission context:",
    `- Target site: ${siteLabel(scenario.site.id)} at ${scenario.site.latDeg}° N / ${scenario.site.eastLonDeg}° E`,
    `- Mission epoch: ${scenario.dateUtc} ${String(scenario.hourUtc ?? 12).padStart(2, "0")}:00 UTC`,
    `- View mode: ${scenario.viewMode}`,
    "",
    "You must answer the astronaut's question and, when the conversation calls for it, drive the mission interface.",
    "Respond with a single JSON object and no surrounding prose (or fenced code block). Exact shape:",
    '{"reply": "...", "action": {"type": "...", "id": "...", "dateUtc": "...", "hourUtc": 12, "constraints": [{"id": "...", "kind": "..."}]}}',
    `Allowed action types: "quick_action", "date", "hour", "constraints", "none".`,
    'Allowed quick_action ids: ' + quickIds.join(", ") + ".",
    'For "quick_action" set "id" to one of those ids. For "date" set "dateUtc" to "YYYY-MM-DD". For "hour" set "hourUtc" to an integer 0-23. For "constraints" set "constraints" to an array of {"id": "...", "kind": "..."} objects. For "none", omit the rest of the action fields.',
    'For purely conversational answers, use "action": {"type": "none"} and put the answer in "reply".',
  ].join("\n");
}

/** Extract and normalize the JSON action spec from a raw model response. */
export function parseGroqAction(content: string): GroqActionSpec {
  let text = (content ?? "").trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) text = fence[1].trim();
  try {
    const parsed = JSON.parse(text) as Partial<GroqActionSpec>;
    const actionType = parsed.action?.type;
    const action: GroqActionSpec["action"] =
      actionType === "quick_action" || actionType === "date" || actionType === "hour" || actionType === "constraints"
        ? {
            type: actionType,
            id: parsed.action?.id,
            dateUtc: parsed.action?.dateUtc,
            hourUtc: parsed.action?.hourUtc,
            constraints: parsed.action?.constraints,
          }
        : { type: "none" };
    return { reply: parsed.reply, action };
  } catch {
    return { action: { type: "none" }, reply: text };
  }
}

function defaultReply(message: string, scenario: { site: { id: string } }): string {
  return [
    `Mission Assistant is analyzing your request ("${message}") for **${scenario.site.id}**.`,
    "You can also try quick actions from the Isle below, or ask me to switch sites, shift the epoch, or run an analysis.",
  ].join(" ");
}

/**
 * Create a Groq-backed mission assistant. `respond` resolves with a mission
 * action result; on any provider failure it degrades gracefully to the local
 * deterministic rule engine.
 */
export function createGroqMissionAssistant(config: GroqAssistantConfig): MissionAssistant {
  const apiKey = (config.apiKey ?? "").trim();
  const model = (config.model ?? GROQ_MODEL).trim() || GROQ_MODEL;
  const baseUrl = (config.baseUrl ?? GROQ_API_BASE_URL).trim().replace(/\/$/, "");

  return {
    id: "groq-mission-assistant",
    respond: async (input: MissionAssistantInput): Promise<MissionActionResult> => {
      if (!apiKey) {
        return localMissionAssistant.respond(input);
      }

      try {
        const systemPrompt = buildMissionSystemPrompt(input.scenario);
        const completion = await fetch(`${baseUrl}/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model,
            temperature: 0.2,
            response_format: { type: "json_object" },
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: input.message },
            ],
          }),
        });

        if (!completion.ok) {
          const detail = await completion.text().catch(() => "");
          throw new Error(`Groq chat completions failed with status ${completion.status}${detail ? `: ${detail}` : ""}`);
        }
        const data = (await completion.json()) as GroqChatCompletionResponse;
        const content = data?.choices?.[0]?.message?.content ?? "";
        const spec = parseGroqAction(content);
        const replyText = spec.reply?.trim() || defaultReply(input.message, input.scenario);
        const action = spec.action;

        if (action?.type === "quick_action" && action.id) {
          const result = executeQuickAction(action.id, input.scenario);
          return { ...result, replyText };
        }

        const updatedScenario: MissionActionResult["updatedScenario"] =
          action?.type === "date" && action.dateUtc
            ? { ...input.scenario, dateUtc: action.dateUtc }
            : action?.type === "hour" && typeof action.hourUtc === "number"
              ? { ...input.scenario, hourUtc: action.hourUtc }
              : action?.type === "constraints" && action.constraints
                ? { ...input.scenario, constraints: action.constraints }
                : undefined;

        return { userMessage: input.message, replyText, updatedScenario };
      } catch (error) {
        console.warn("[AI] Groq request failed, using local rule engine:", error);
        return localMissionAssistant.respond(input);
      }
    },
  };
}

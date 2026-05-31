// Claude structured-output helpers. We use Anthropic tool_use as the
// structured-output mechanism: force the model to call a tool whose
// input_schema is a Zod schema converted via zod-to-json-schema. We safeParse
// the tool call; on Zod failure we make ONE retry with the issue messages
// fed back to the model.
//
// The same forcedToolCall helper is shared by:
//   extractMenu (Phase 5)               — multimodal menu → MenuExtraction
//   parseQuoteReply (Phase 6)            — distributor email → QuoteExtraction
//   writeRecommendationRationale (Phase 6) — score draft → RecommendationRationale

import Anthropic from "@anthropic-ai/sdk";
import type { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { withRetry, TimeoutError } from "./net";
import {
  MenuExtractionSchema,
  QuoteExtractionSchema,
  RecommendationRationaleSchema,
  type MenuExtraction,
  type QuoteExtraction,
  type RecommendationRationale,
} from "./schemas";
import { required } from "./env";

const MODEL = "claude-sonnet-4-6";
const MAX_TOKENS = 8192;

type ContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; source: { type: "base64"; media_type: string; data: string } }
  | { type: "document"; source: { type: "base64"; media_type: "application/pdf"; data: string } };

export type MenuContent = ContentBlock[];

interface ToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: unknown;
}

function findToolUse(content: Anthropic.Messages.ContentBlock[]): ToolUseBlock | null {
  for (const block of content) {
    if (block.type === "tool_use") return block as ToolUseBlock;
  }
  return null;
}

// jsonSchema7 + $refStrategy:"none" + strip $schema → flat draft-7-ish object
// that Anthropic accepts as tool input_schema.
function toolSchemaFor<S extends z.ZodTypeAny>(schema: S): Record<string, unknown> {
  const raw = zodToJsonSchema(schema, {
    target: "jsonSchema7",
    $refStrategy: "none",
  }) as Record<string, unknown>;
  delete raw.$schema;
  return raw;
}

interface ForcedToolCallOptions<S extends z.ZodTypeAny> {
  toolName: string;
  toolDescription: string;
  systemPrompt: string;
  outputSchema: S;
  content: MenuContent;
}

/**
 * Run a forced-tool-use Claude call with Zod validation + one retry on
 * Zod failure (issues fed back to the model via tool_result with is_error).
 */
async function forcedToolCall<S extends z.ZodTypeAny>(
  opts: ForcedToolCallOptions<S>,
): Promise<z.infer<S>> {
  const apiKey = required("ANTHROPIC_API_KEY");
  const client = new Anthropic({ apiKey });

  const tool: Anthropic.Messages.Tool = {
    name: opts.toolName,
    description: opts.toolDescription,
    input_schema: toolSchemaFor(opts.outputSchema) as Anthropic.Messages.Tool["input_schema"],
  };

  const baseMessages: Anthropic.Messages.MessageParam[] = [
    {
      role: "user",
      content: opts.content as unknown as Anthropic.Messages.MessageParam["content"],
    },
  ];

  // 90s deadline (Claude with tool-use on multimodal menus can run long);
  // 1 retry on overload (529) or transient network errors. 4xx is permanent.
  // We pass `signal` so the underlying fetch is actually cancelled on
  // timeout, not left dangling (Convex flags dangling promises).
  const callClaude = async (messages: Anthropic.Messages.MessageParam[]) => {
    const TIMEOUT_MS = 90_000;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      return await client.messages.create(
        {
          model: MODEL,
          max_tokens: MAX_TOKENS,
          system: opts.systemPrompt,
          tools: [tool],
          tool_choice: { type: "tool", name: opts.toolName },
          messages,
        },
        { signal: controller.signal, timeout: TIMEOUT_MS },
      );
    } catch (err) {
      if (
        controller.signal.aborted ||
        (err instanceof Error && (err.name === "AbortError" || err.name === "APIUserAbortError"))
      ) {
        throw new TimeoutError("anthropic.messages.create", TIMEOUT_MS);
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  };

  const callClaudeRetried = (messages: Anthropic.Messages.MessageParam[]) =>
    withRetry(() => callClaude(messages), {
      attempts: 2,
      baseMs: 500,
      label: "anthropic.messages.create",
      retryOn: (err) => {
        if (err instanceof Error && err.name === "TimeoutError") return true;
        // Anthropic SDK throws APIError with .status; 529 = overload, 5xx = transient
        const status = (err as { status?: number })?.status;
        if (typeof status === "number") return status === 529 || status >= 500;
        return false;
      },
    });

  // ── attempt 1 ─────────────────────────────────────────────────
  const first = await callClaudeRetried(baseMessages);

  const firstToolUse = findToolUse(first.content);
  if (!firstToolUse) {
    throw new Error(`Claude did not call ${opts.toolName} on first attempt.`);
  }
  const firstParse = opts.outputSchema.safeParse(firstToolUse.input);
  if (firstParse.success) return firstParse.data;

  // ── attempt 2 (retry once with issue messages) ────────────────
  const issues = firstParse.error.issues
    .slice(0, 12)
    .map((iss) => `- at ${iss.path.join(".") || "(root)"}: ${iss.message}`)
    .join("\n");

  const retryMessages: Anthropic.Messages.MessageParam[] = [
    ...baseMessages,
    {
      role: "assistant",
      content: [
        {
          type: "tool_use",
          id: firstToolUse.id,
          name: firstToolUse.name,
          input: firstToolUse.input,
        },
      ],
    },
    {
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: firstToolUse.id,
          is_error: true,
          content: `The tool call failed validation. Fix these issues and call ${opts.toolName} again:\n${issues}`,
        },
      ],
    },
  ];

  const second = await callClaudeRetried(retryMessages);

  const secondToolUse = findToolUse(second.content);
  if (!secondToolUse) {
    throw new Error(`Claude did not call ${opts.toolName} on retry.`);
  }
  const secondParse = opts.outputSchema.safeParse(secondToolUse.input);
  if (!secondParse.success) {
    const summary = secondParse.error.issues
      .slice(0, 5)
      .map((iss) => `${iss.path.join(".") || "(root)"}: ${iss.message}`)
      .join("; ");
    throw new Error(`Claude tool output failed validation after retry: ${summary}`);
  }
  return secondParse.data;
}

// ── Shared style guidance ────────────────────────────────────────

// Applied to every Claude call in this file. Em dashes are banned project-wide
// in user-facing text (see CLAUDE.md "Typography"); the model copies its
// prompt's punctuation habits into its outputs, so we tell it explicitly.
const NO_EM_DASH_RULE =
  "Style: do not use em dashes (—, U+2014) anywhere in your output. " + // allow-em-dash
  "Use periods, commas, semicolons, colons, or parentheses instead. " +
  "This applies to every string field including headlines, rationales, dish names, descriptions, and notes.";

// ── extractMenu (Phase 5) ────────────────────────────────────────

const MENU_SYSTEM = `You are an experienced restaurant chef helping a procurement agent decompose menus into ingredient baskets.

For every dish on the menu, list every distinct ingredient needed for a SINGLE SERVING (one plate). Menus never list quantities. Use your chef judgement to estimate. State your key assumption when confidence is medium or low.

Be conservative with confidence. Vague dish names, house specials with no description, or ambiguous cuts should be flagged with confidence:"low" + needsReview:true. Procurement decisions cascade off these flags.

canonicalName must be SINGULAR, lowercased, and brand/cultivar/grade stripped so we can dedup across dishes. Examples: "San Marzano tomatoes" -> "tomato"; "fresh mozzarella di bufala" -> "mozzarella cheese"; "EVOO" -> "olive oil"; "ground beef (80/20)" -> "ground beef".

Skip section headers ("Antipasti"), prices, allergen notes, and footers.

Always call the record_menu tool to return results. Never reply with prose.

${NO_EM_DASH_RULE}`;

export async function extractMenu(content: MenuContent): Promise<MenuExtraction> {
  return forcedToolCall({
    toolName: "record_menu",
    toolDescription:
      "Record the structured menu extraction. Must include every dish (skip section headers) with per-serving ingredient estimates.",
    systemPrompt: MENU_SYSTEM,
    outputSchema: MenuExtractionSchema,
    content,
  });
}

// ── parseQuoteReply (Phase 6) ────────────────────────────────────

const QUOTE_SYSTEM = `You are a procurement analyst extracting a structured quote from a distributor's free-text email reply to our RFP.

We will give you (1) the basket we asked them to quote (a list of {canonicalName, quantity, unit}) and (2) the distributor's reply text (already stripped of quoted history).

For every basket line the distributor responded to, emit a QuoteLine. For lines they explicitly said they don't carry / are out of stock: set available:false and price:null. If they quoted a price without saying anything about availability: assume available:true.

canonicalName MUST match our basket's canonical names whenever you're confident (e.g. their "San Marzano DOP" maps to our "tomato"). When unsure, use your best singular common-noun guess; the caller will reconcile.

Set missingInfo:true if ANY basket line is absent from the reply OR a quoted line lacks a price. This flags an autonomous follow-up.

Extract deliveryTerms / paymentTerms / leadTime verbatim when stated. totalPrice only if the distributor stated a basket total themselves; do NOT compute it.

Be conservative with parseConfidence: "low" if the reply is short/ambiguous, "high" only when every basket line was addressed with a clear price+unit.

Always call the record_quote tool. Never reply with prose.

${NO_EM_DASH_RULE}`;

export async function parseQuoteReply(
  rawEmailBody: string,
  basket: { canonicalName: string; quantity: number; unit: string }[],
  distributorName: string,
): Promise<QuoteExtraction> {
  const basketBlock = basket
    .map((b) => `- ${b.canonicalName} (${b.quantity} ${b.unit})`)
    .join("\n");

  const content: MenuContent = [
    {
      type: "text",
      text: `BASKET (what we asked for):\n${basketBlock}\n\nDISTRIBUTOR: ${distributorName}\n\nREPLY (stripped of quoted history):\n${rawEmailBody}`,
    },
  ];

  return forcedToolCall({
    toolName: "record_quote",
    toolDescription:
      "Record the structured quote extraction from the distributor's reply. Cover every basket line they addressed; flag missing info.",
    systemPrompt: QUOTE_SYSTEM,
    outputSchema: QuoteExtractionSchema,
    content,
  });
}

// ── writeRecommendationRationale (Phase 6) ──────────────────────

const RATIONALE_SYSTEM = `You are a procurement analyst writing a brief, candid award rationale for a restaurant client.

You will be given a recommendation draft: the top distributor (or null), any complementary splits, gaps, estimated savings vs USDA baseline, and approval flags. Write a one-sentence headline (≤ 90 chars) and a 2 to 3 sentence rationale grounded in price, basket coverage, and payment/delivery terms.

If needsHumanApproval is true, name the specific reason in the rationale (thin margin, low completeness, missing info, no viable quote).

Always call the record_rationale tool. Never reply with prose.

${NO_EM_DASH_RULE}`;

interface RationaleInput {
  primary?: {
    distributorName: string;
    totalPrice: number | null;
    completenessScore: number;
    paymentTerms?: string;
    deliveryTerms?: string;
  } | null;
  splits: { distributorName: string; role: string; weeklyValue: number }[];
  gaps: { item: string; reason: string }[];
  margin: number;
  confidence: "high" | "medium" | "low";
  needsHumanApproval: boolean;
  estSavings: number;
  estBaseline: number;
}

export async function writeRecommendationRationale(
  input: RationaleInput,
): Promise<RecommendationRationale> {
  const summary = JSON.stringify(input, null, 2);
  const content: MenuContent = [
    {
      type: "text",
      text: `RECOMMENDATION DRAFT:\n${summary}`,
    },
  ];

  return forcedToolCall({
    toolName: "record_rationale",
    toolDescription:
      "Write the human-readable headline and rationale for this recommendation draft.",
    systemPrompt: RATIONALE_SYSTEM,
    outputSchema: RecommendationRationaleSchema,
    content,
  });
}

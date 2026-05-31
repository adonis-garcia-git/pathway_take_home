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
// Haiku 4.5 is ~3x faster than Sonnet for bounded structured extraction
// and reliable enough for menu / quote parsing. Reserved for high-volume,
// well-bounded tasks. Slower-but-stronger Sonnet stays for synthesis tasks
// like the recommendation rationale.
const FAST_MODEL = "claude-haiku-4-5-20251001";
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
  // Optional per-call model override. Defaults to MODEL (Sonnet 4.6).
  // Pass FAST_MODEL for bounded structured tasks where latency matters.
  model?: string;
}

/**
 * Run a forced-tool-use Claude call with Zod validation + one retry on
 * Zod failure (issues fed back to the model via tool_result with is_error).
 */
async function forcedToolCall<S extends z.ZodTypeAny>(
  opts: ForcedToolCallOptions<S>,
): Promise<z.infer<S>> {
  const apiKey = required("ANTHROPIC_API_KEY");
  // maxRetries: 0 disables the SDK's internal retry loop. We do our own
  // bounded retry via withRetry; stacking both produces overlapping
  // stream-close races (the Convex V8 isolate is strict about dangling
  // stream lifecycles).
  const client = new Anthropic({ apiKey, maxRetries: 0 });

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

  // 120s deadline. Claude with tool-use on long multimodal/text content can
  // run long; Haiku at ~30KB usually returns in well under 30s but we keep
  // headroom for Sonnet rationale calls. We pass `signal` so the underlying
  // fetch is actually cancelled on timeout, not left dangling.
  const modelToUse = opts.model ?? MODEL;
  const callClaude = async (messages: Anthropic.Messages.MessageParam[]) => {
    const TIMEOUT_MS = 120_000;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      // Pass only `signal`, not `timeout`. The SDK's own timeout fires its
      // own AbortController internally, and the two can race during stream
      // cleanup, producing "The stream is not in a state that permits close".
      return await client.messages.create(
        {
          model: modelToUse,
          max_tokens: MAX_TOKENS,
          system: opts.systemPrompt,
          tools: [tool],
          tool_choice: { type: "tool", name: opts.toolName },
          messages,
        },
        { signal: controller.signal },
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
        // Do NOT retry on TimeoutError. If Claude took >120s once, retrying
        // with the exact same input is almost certain to time out again and
        // burns another 120s budget. Surface the timeout to the caller.
        // SDK / runtime race during stream cleanup. Idempotent retry.
        if (
          err instanceof TypeError &&
          /stream is not in a state that permits close/i.test(err.message)
        ) {
          return true;
        }
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

const MENU_TOOL_DESCRIPTION =
  "Record the structured menu extraction. Must include every dish (skip section headers) with per-serving ingredient estimates.";

const NO_MENU_FOUND_MESSAGE =
  "Could not find menu content on this page. The URL might not include the menu directly, or the page might rely on JavaScript to render content the static fetch cannot see. Try the direct menu URL, or use Paste Text and copy the menu in.";

function looksLikeStructuredOutputFailure(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return (
    /failed validation/i.test(err.message) ||
    /did not call/i.test(err.message) ||
    /dishes: required/i.test(err.message)
  );
}

export async function extractMenu(content: MenuContent): Promise<MenuExtraction> {
  // Two-stage strategy. Haiku 4.5 is faster but its forced tool-use on a
  // nested schema can occasionally produce empty/malformed output. On any
  // structured-output failure (validation, no tool call), we transparently
  // fall back to Sonnet, which is more reliable on complex schemas. If
  // both fail OR succeed with zero dishes, surface a clean user-visible
  // error rather than letting the run silently continue with no data.
  let extraction: MenuExtraction | null = null;

  try {
    extraction = await forcedToolCall({
      toolName: "record_menu",
      toolDescription: MENU_TOOL_DESCRIPTION,
      systemPrompt: MENU_SYSTEM,
      outputSchema: MenuExtractionSchema,
      content,
      model: FAST_MODEL,
    });
  } catch (haikuErr) {
    if (!looksLikeStructuredOutputFailure(haikuErr)) throw haikuErr;
    console.warn(
      `[extractMenu] Haiku failed structured output (${haikuErr instanceof Error ? haikuErr.message : "unknown"}); retrying with Sonnet.`,
    );
    try {
      extraction = await forcedToolCall({
        toolName: "record_menu",
        toolDescription: MENU_TOOL_DESCRIPTION,
        systemPrompt: MENU_SYSTEM,
        outputSchema: MenuExtractionSchema,
        content,
        model: MODEL,
      });
    } catch (sonnetErr) {
      if (looksLikeStructuredOutputFailure(sonnetErr)) {
        throw new Error(NO_MENU_FOUND_MESSAGE);
      }
      throw sonnetErr;
    }
  }

  if (extraction.dishes.length === 0) {
    throw new Error(NO_MENU_FOUND_MESSAGE);
  }
  return extraction;
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
    model: FAST_MODEL,
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

// ── generateDistributorReply (Phase 18 demo) ────────────────────
//
// Plain-text Claude call (no tool use). Produces a realistic distributor
// reply body for the demoLlmReplyForRun simulator. Per-line target prices
// are passed in the prompt so the downstream recommendation engine still
// lands a clear winner within the chosen margin band.

const DISTRIBUTOR_REPLY_SYSTEM = `You are role-playing a wholesale food distributor replying to an RFP from a small restaurant. Write a SHORT plain-text email reply, no greeting line beyond "Hi" or similar, no signature block beyond your distributor name on the last line.

Quote every basket line at the exact target price you are given. Keep units exact (lb, L, dozen, each). Vary your format and tone naturally across calls: a dash list, a numbered list, or short prose are all fine, pick one per reply. Do not invent new line items, do not change names.

After the line items, ALWAYS include three pieces of information on their own short lines or sentences, before the signature:
1. A stated weekly basket total in the format "Total estimated weekly basket: $X" (where X is the sum of each priced line's price times its weekly quantity, rounded to two decimals).
2. A lead time, for example "Lead time: 24 hours" or "Lead time: 2 business days". Choose based on the terms hint (primary: 24 hours; secondary: 2 business days; competitor: 3 to 5 business days).
3. Payment and delivery terms as a short prose line.

If the input says omitOneLine is true, pick the most specialty-sounding line in the basket (rare cheese, imported oil, specialty cut) and instead of pricing it write "currently checking with our supplier, will follow up shortly" or equivalent. Do not omit more than one. Exclude that line from the weekly total.

End with the distributor's name on its own last line. Do not include subject lines, headers, or quoted reply chains.

${NO_EM_DASH_RULE}`;

export interface DistributorReplyInput {
  distributorName: string;
  distributorCategories: string[];
  restaurantName: string;
  basketLines: {
    canonicalName: string;
    quantity: number;
    unit: string;
    targetPricePerUnit: number;
  }[];
  termsHint: "primary" | "secondary" | "competitor";
  omitOneLine: boolean;
}

/**
 * Generate one distributor-voiced reply via Claude (Haiku) and return the
 * raw email body. Never throws inside the action that calls it; the caller
 * should catch and fall back to a templated reply on failure if desired.
 */
export async function generateDistributorReply(
  input: DistributorReplyInput,
): Promise<string> {
  const apiKey = required("ANTHROPIC_API_KEY");
  const client = new Anthropic({ apiKey, maxRetries: 0 });

  const termsGuide =
    input.termsHint === "primary"
      ? "Terms preference: Net 30, daily delivery, $250 minimum order. You are a confident high-volume supplier."
      : input.termsHint === "secondary"
        ? "Terms preference: Net 30, Mon/Wed/Fri delivery, $300 minimum order. You are a specialty supplier with strong selection."
        : "Terms preference: Net 15, weekly delivery, $400 minimum order. You are a smaller competitor and your prices reflect that.";

  const basketBlock = input.basketLines
    .map(
      (l) =>
        `- ${l.canonicalName} (${l.quantity} ${l.unit}/wk): target $${l.targetPricePerUnit.toFixed(2)}/${l.unit}`,
    )
    .join("\n");

  const userPrompt = [
    `DISTRIBUTOR: ${input.distributorName}`,
    `CATEGORIES: ${input.distributorCategories.join(", ") || "general"}`,
    `RESTAURANT: ${input.restaurantName}`,
    termsGuide,
    `omitOneLine: ${input.omitOneLine}`,
    "",
    "BASKET (quote at the target price per unit):",
    basketBlock,
    "",
    "Write the reply body now.",
  ].join("\n");

  const TIMEOUT_MS = 60_000;
  const callOnce = async (): Promise<string> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await client.messages.create(
        {
          model: FAST_MODEL,
          max_tokens: 1024,
          system: DISTRIBUTOR_REPLY_SYSTEM,
          messages: [{ role: "user", content: userPrompt }],
        },
        { signal: controller.signal },
      );
      const text = res.content
        .filter((b): b is Anthropic.Messages.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .trim();
      if (!text) throw new Error("empty reply body from Claude");
      return text;
    } catch (err) {
      if (
        controller.signal.aborted ||
        (err instanceof Error &&
          (err.name === "AbortError" || err.name === "APIUserAbortError"))
      ) {
        throw new TimeoutError("anthropic.generateDistributorReply", TIMEOUT_MS);
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  };

  return withRetry(callOnce, {
    attempts: 2,
    baseMs: 500,
    label: "anthropic.generateDistributorReply",
    retryOn: (err) => {
      if (
        err instanceof TypeError &&
        /stream is not in a state that permits close/i.test(err.message)
      ) {
        return true;
      }
      const status = (err as { status?: number })?.status;
      if (typeof status === "number") return status === 529 || status >= 500;
      return false;
    },
  });
}

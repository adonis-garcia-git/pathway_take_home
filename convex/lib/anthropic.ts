// Claude menu extraction. We use tool use as the structured-output mechanism:
// the model is forced to call `record_menu` whose input_schema is the JSON
// Schema of MenuExtractionSchema. We safeParse the tool call; on Zod failure
// we make exactly ONE retry with the issue messages fed back to the model.

import Anthropic from "@anthropic-ai/sdk";
import { zodToJsonSchema } from "zod-to-json-schema";
import { MenuExtractionSchema, type MenuExtraction } from "./schemas";
import { required } from "./env";

const MODEL = "claude-sonnet-4-6";
const MAX_TOKENS = 8192;
const TOOL_NAME = "record_menu";

// Convert Zod → JSON Schema. The output type is `object` at the top level
// (Anthropic's tool input_schema requires this).
// jsonSchema7 + $refStrategy:"none" produces a flat draft-7-ish schema that
// Anthropic accepts as tool input_schema. The default target ("jsonSchema7")
// wraps in a $schema/$ref envelope which Anthropic rejects — we strip $schema
// to keep the body draft-2020-12 compatible.
const rawSchema = zodToJsonSchema(MenuExtractionSchema, {
  target: "jsonSchema7",
  $refStrategy: "none",
}) as Record<string, unknown>;
delete rawSchema.$schema;
const TOOL_INPUT_SCHEMA = rawSchema;

const SYSTEM_PROMPT = `You are an experienced restaurant chef helping a procurement agent decompose menus into ingredient baskets.

For every dish on the menu, list every distinct ingredient needed for a SINGLE SERVING (one plate). Menus never list quantities — use your chef judgement to estimate. State your key assumption when confidence is medium or low.

Be conservative with confidence. Vague dish names, house specials with no description, or ambiguous cuts should be flagged with confidence:"low" + needsReview:true. Procurement decisions cascade off these flags.

canonicalName must be SINGULAR, lowercased, and brand/cultivar/grade stripped so we can dedup across dishes. Examples: "San Marzano tomatoes" → "tomato"; "fresh mozzarella di bufala" → "mozzarella cheese"; "EVOO" → "olive oil"; "ground beef (80/20)" → "ground beef".

Skip section headers ("Antipasti"), prices, allergen notes, and footers.

Always call the record_menu tool to return results — never reply with prose.`;

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

/**
 * Extract a menu using Claude. Forces tool_use of record_menu. On Zod failure,
 * makes ONE retry with the issue messages fed back. Throws on second failure.
 */
export async function extractMenu(content: MenuContent): Promise<MenuExtraction> {
  const apiKey = required("ANTHROPIC_API_KEY");
  const client = new Anthropic({ apiKey });

  const tool: Anthropic.Messages.Tool = {
    name: TOOL_NAME,
    description:
      "Record the structured menu extraction. Must include every dish (skip section headers) with per-serving ingredient estimates.",
    input_schema: TOOL_INPUT_SCHEMA as Anthropic.Messages.Tool["input_schema"],
  };

  const baseMessages: Anthropic.Messages.MessageParam[] = [
    // The SDK's union type for message content includes our text/image/document
    // shapes; cast through unknown to avoid SDK-version churn on the param name.
    { role: "user", content: content as unknown as Anthropic.Messages.MessageParam["content"] },
  ];

  // ── attempt 1 ─────────────────────────────────────────────────
  const first = await client.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: SYSTEM_PROMPT,
    tools: [tool],
    tool_choice: { type: "tool", name: TOOL_NAME },
    messages: baseMessages,
  });

  const firstToolUse = findToolUse(first.content);
  if (!firstToolUse) {
    throw new Error("Claude did not call record_menu on first attempt.");
  }
  const firstParse = MenuExtractionSchema.safeParse(firstToolUse.input);
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
          content: `The tool call failed validation. Fix these issues and call record_menu again:\n${issues}`,
        },
      ],
    },
  ];

  const second = await client.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: SYSTEM_PROMPT,
    tools: [tool],
    tool_choice: { type: "tool", name: TOOL_NAME },
    messages: retryMessages,
  });

  const secondToolUse = findToolUse(second.content);
  if (!secondToolUse) {
    throw new Error("Claude did not call record_menu on retry.");
  }
  const secondParse = MenuExtractionSchema.safeParse(secondToolUse.input);
  if (!secondParse.success) {
    const summary = secondParse.error.issues
      .slice(0, 5)
      .map((iss) => `${iss.path.join(".") || "(root)"}: ${iss.message}`)
      .join("; ");
    throw new Error(`Claude tool output failed validation after retry: ${summary}`);
  }
  return secondParse.data;
}

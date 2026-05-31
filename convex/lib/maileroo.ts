// Maileroo Send Basic Email client + Zod schema for inbound webhook payloads.
// Single source of truth for both wire shapes — outbound + inbound.
//
// Docs reference: https://docs.maileroo.com/docs/email-api (Send Basic Email)
// and https://docs.maileroo.com/docs/inbound (Inbound Routes).
//
// We intentionally use plain `fetch` (no SDK) and validate every byte that
// crosses the trust boundary with Zod.

import { z } from "zod";
import { fetchWithTimeout, withRetry, HttpError, TimeoutError } from "./net";

const SEND_ENDPOINT = "https://smtp.maileroo.com/api/v2/emails";

export interface SendBasicEmailInput {
  apiKey: string;
  from: string;
  to: string;
  subject: string;
  html: string;
  replyTo: string;
  tags?: Record<string, string>;
}

export interface SendBasicEmailResult {
  ok: boolean;
  status: number;
  messageId?: string;
  error?: string;
}

const sendResponseSchema = z
  .object({
    success: z.boolean().optional(),
    message: z.string().optional(),
    data: z
      .object({
        reference_id: z.string().optional(),
        message_id: z.string().optional(),
      })
      .partial()
      .optional(),
  })
  .passthrough();

// Parse "Display Name <addr@host>" or bare "addr@host" into Maileroo's
// `{ address, display_name? }` object format. The v2 send API rejects plain
// strings — it expects either an address object or an array of them.
function asAddressObject(raw: string): { address: string; display_name?: string } {
  const match = raw.match(/^\s*(.*?)\s*<([^>]+)>\s*$/);
  if (match && match[2]) {
    const display = match[1].trim();
    return display ? { address: match[2].trim(), display_name: display } : { address: match[2].trim() };
  }
  return { address: raw.trim() };
}

export async function sendBasicEmail(input: SendBasicEmailInput): Promise<SendBasicEmailResult> {
  const body: Record<string, unknown> = {
    from: asAddressObject(input.from),
    to: [asAddressObject(input.to)],
    subject: input.subject,
    html: input.html,
    reply_to: asAddressObject(input.replyTo),
  };
  if (input.tags) body.tags = input.tags;

  let res: Response;
  try {
    // Retry transient failures (timeout / 5xx / 429) but NOT 4xx — Maileroo's
    // 4xx are typically "bad recipient" which is terminal; retrying just wastes budget.
    res = await withRetry(
      () =>
        fetchWithTimeout(SEND_ENDPOINT, {
          method: "POST",
          timeoutMs: 8_000,
          label: "maileroo.send",
          headers: {
            "Content-Type": "application/json",
            "X-Api-Key": input.apiKey,
          },
          body: JSON.stringify(body),
        }).then(async (r) => {
          if (r.status >= 500 || r.status === 429) {
            // Throw to trigger the retry policy; preserve body for diagnostics.
            throw new HttpError("maileroo.send", r.status, await r.clone().text());
          }
          return r;
        }),
      { attempts: 2, baseMs: 400, label: "maileroo.send" },
    );
  } catch (e) {
    if (e instanceof HttpError) {
      return { ok: false, status: e.status, error: e.message };
    }
    if (e instanceof TimeoutError) {
      return { ok: false, status: 0, error: e.message };
    }
    return { ok: false, status: 0, error: e instanceof Error ? e.message : String(e) };
  }

  const text = await res.text();
  let parsed: z.infer<typeof sendResponseSchema> | undefined;
  try {
    parsed = sendResponseSchema.parse(JSON.parse(text));
  } catch {
    parsed = undefined;
  }

  if (!res.ok || parsed?.success === false) {
    return {
      ok: false,
      status: res.status,
      error: parsed?.message ?? text.slice(0, 500),
    };
  }

  const messageId = parsed?.data?.reference_id ?? parsed?.data?.message_id;
  return { ok: true, status: res.status, messageId };
}

// ─── Inbound payload schema ──────────────────────────────────────────
//
// Maileroo inbound routes POST a JSON envelope with parsed MIME, parsed
// headers, attachment URLs, deletion + validation URLs. We accept the
// envelope conservatively (extra fields ignored) and the body fields we
// actually use are required.

export const mailerooInboundSchema = z.object({
  message_id: z.string(),
  domain: z.string(),
  envelope_sender: z.string(),
  recipients: z.array(z.string()),
  headers: z.record(z.string(), z.union([z.string(), z.array(z.string())])).default({}),
  body: z.object({
    plaintext: z.string().optional().default(""),
    html: z.string().optional().default(""),
    stripped_plaintext: z.string().optional().default(""),
    stripped_html: z.string().optional().default(""),
    raw_mime: z.object({ url: z.string() }).partial().optional(),
  }),
  is_dmarc_aligned: z.boolean().optional().default(false),
  spf_result: z.string().optional().default(""),
  dkim_result: z.string().optional().default(""),
  is_spam: z.boolean().optional().default(false),
  deletion_url: z.string().optional().default(""),
  validation_url: z.string(),
  attachments: z
    .array(z.object({ url: z.string() }).passthrough())
    .optional()
    .default([]),
});

export type MailerooInbound = z.infer<typeof mailerooInboundSchema>;

// Hostnames we'll fetch validation_url against. A forged inbound webhook
// could try to point validation_url at internal infra; restrict to
// Maileroo-owned hosts to prevent SSRF. Localhost is allowed for tests.
const MAILEROO_HOST_SUFFIXES = [".maileroo.com", "maileroo.com"];
const LOCAL_VALIDATION_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

function isAllowedValidationHost(rawUrl: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return false;
  const host = parsed.hostname.toLowerCase();
  if (LOCAL_VALIDATION_HOSTS.has(host)) return true;
  return MAILEROO_HOST_SUFFIXES.some(
    (s) => host === s.replace(/^\./, "") || host.endsWith(s),
  );
}

// Call the payload's validation_url to confirm Maileroo really sent this
// webhook. The docs accept either GET or POST; we try GET first then POST.
// Expected success shape: { success: true }.
export async function verifyMailerooInbound(validationUrl: string): Promise<boolean> {
  // SSRF guard: only fetch URLs whose host is Maileroo (or localhost for tests).
  if (!isAllowedValidationHost(validationUrl)) {
    console.warn(`[maileroo.verify] rejected validation_url: ${validationUrl}`);
    return false;
  }
  // 5s per method, no retry — Maileroo redelivers on a non-2xx response,
  // so retrying here just delays the redelivery loop.
  const tryMethod = async (method: "GET" | "POST"): Promise<boolean> => {
    try {
      const res = await fetchWithTimeout(validationUrl, {
        method,
        timeoutMs: 5_000,
        label: `maileroo.verify(${method})`,
      });
      if (!res.ok) return false;
      const json = (await res.json()) as { success?: boolean };
      return json?.success === true;
    } catch {
      return false;
    }
  };
  if (await tryMethod("GET")) return true;
  return tryMethod("POST");
}

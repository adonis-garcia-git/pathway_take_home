// HTTP routes for Convex. Currently just the Maileroo inbound webhook.
//
// Authenticity contract: Maileroo does NOT sign inbound payloads. The only
// proof a payload is real is calling its `validation_url` once; if it
// answers `{"success": true}`, the payload is genuine. We do that on every
// hit. Spammy mail (is_spam=true) is acknowledged with 200 but ignored.
//
// Maileroo retries non-2xx responses (5/10/15/30 min → 1/2/4/6h), so we
// MUST be idempotent. Dedupe lives in convex/quotes.ts:recordInboundQuote
// keyed by `mailerooMessageId`.

import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { mailerooInboundSchema, verifyMailerooInbound } from "./lib/maileroo";
import { distributorIdFromReplyAddress } from "./lib/replyAddress";

const http = httpRouter();

http.route({
  path: "/maileroo/inbound",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    let json: unknown;
    try {
      json = await req.json();
    } catch {
      return new Response("invalid json", { status: 400 });
    }

    const parsed = mailerooInboundSchema.safeParse(json);
    if (!parsed.success) {
      return new Response(`invalid payload: ${parsed.error.message}`, { status: 400 });
    }
    const payload = parsed.data;

    // Authenticity: hit validation_url. On failure → 401.
    const verified = await verifyMailerooInbound(payload.validation_url);
    if (!verified) return new Response("unverified", { status: 401 });

    // Spam: ack with 200 so Maileroo doesn't retry; no side-effects.
    if (payload.is_spam) return new Response("ok (spam)", { status: 200 });

    // DMARC: drop unauthenticated mail. Without this any sender could
    // impersonate one of our distributors with a forged From and flip an
    // rfpRecipient to "replied". The Zod schema defaults the field to false
    // when missing, so we explicitly require true.
    if (!payload.is_dmarc_aligned) {
      return new Response("ok (dmarc unaligned)", { status: 200 });
    }

    // Find the matching rfpRecipients row by walking recipients[].
    const replyAddress = payload.recipients.find(
      (addr) => distributorIdFromReplyAddress(addr) !== null,
    );
    if (!replyAddress) {
      // Not addressed to one of our distributor-* sub-addresses. ACK so
      // Maileroo stops retrying, but no work to do.
      return new Response("ok (no match)", { status: 200 });
    }

    const recipient = await ctx.runQuery(internal.quotes.findRecipientByReplyAddress, {
      replyAddress,
    });
    if (!recipient) return new Response("ok (recipient gone)", { status: 200 });

    // Dedupe is enforced inside recordInboundQuote (keyed by message_id).
    await ctx.runMutation(internal.quotes.recordInboundQuote, {
      rfpRecipientId: recipient._id,
      mailerooMessageId: payload.message_id,
      rawEmailBody: payload.body.stripped_plaintext || payload.body.plaintext,
    });

    return new Response("ok", { status: 200 });
  }),
});

export default http;

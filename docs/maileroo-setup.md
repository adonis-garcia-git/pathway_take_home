# Maileroo Setup

This document covers everything operations needs to make outbound RFP emails and inbound quote webhooks work end-to-end. Wire-format details live in `convex/lib/maileroo.ts`; this is the runbook.

## 1. Verify the sending domain

1. In the Maileroo dashboard, add the domain that will appear in the `From:` header (e.g. `pathway.example.com`).
2. Publish the DNS records Maileroo generates:
   - **SPF** (TXT, root `@`): include Maileroo's send hosts.
   - **DKIM** (CNAME or TXT, selector subdomain): copy verbatim — selector hash differs per tenant.
   - **DMARC** (TXT at `_dmarc.<domain>`): start with `v=DMARC1; p=none; rua=mailto:dmarc@<domain>`.
   - **MX** (only required if the same domain receives mail — see Inbound below).
3. Wait for the green check on all four records, then proceed.

## 2. Issue a sending key

Dashboard → **Domains → Sending Keys → Create**. Sending keys are scoped per domain. Copy the value into Convex env:

```
npx convex env set MAILEROO_SENDING_KEY <key>
npx convex env set MAIL_DOMAIN          pathway.example.com
```

If either var is missing, the sender falls back to a **mock** code path: it writes `rfpRecipients` rows with `sentMessageId = "mock:<random>"` and never makes the HTTP call. The simulation path below still works against mock recipients.

## 3. Configure the inbound route

The pipeline routes replies back to the originating `rfpRecipient` row via a sub-address scheme — there is **one** verified inbox per domain, and the local-part encodes the distributor id:

```
distributor-<distributorId>@<MAIL_DOMAIN>
```

This is built by `replyAddressFor` in `convex/lib/replyAddress.ts` and parsed back by `distributorIdFromReplyAddress`. It is the single source of truth — do not inline the format string elsewhere.

In Maileroo:

1. Add MX records pointing the domain at Maileroo inbound servers.
2. Dashboard → **Inbound Routes → Create**.
   - **Match:** wildcard local-part — `distributor-*@<MAIL_DOMAIN>`.
   - **Action:** HTTP webhook.
   - **URL:** `https://<your-convex-deployment>.convex.site/maileroo/inbound`
   - **Method:** POST, **Content-Type:** application/json.
3. Save. Maileroo will deliver every reply addressed to a `distributor-*` local-part to the webhook.

There is **no inbound signing secret**. The webhook authenticates the payload by calling the included `validation_url` and rejecting anything that does not answer `{"success": true}`. Spam-flagged messages (`is_spam: true`) are acknowledged with 200 but ignored.

## 4. Retry behaviour

Maileroo retries non-2xx responses at **5 / 10 / 15 / 30 min → 1 / 2 / 4 / 6 hour** intervals. The webhook must therefore be airtight on dedupe; we key on `quotes.by_mailerooMessageId` inside `recordInboundQuote` and short-circuit any repeat.

## 5. Local / demo path — no DNS required

For local dev or a take-home demo where DNS is not configured, use:

```ts
// Convex dashboard → run action
api.email.simulateInboundReply({ rfpRecipientId: "<id>", bodyText: "..." })
```

This bypasses HTTP + Zod and calls `internal.quotes.recordInboundQuote` directly with a fresh random `message_id`. It exercises the full inbound-side state machine (`rfpRecipients → replied`, `quotes` row insert, `parseInboundQuote` schedule, `checkCollectQuotesDone` schedule), so reactive UI updates the same way they would for a real reply.

Re-running the simulator twice on the same recipient inserts two distinct quotes because the message id is randomised; this is intentional for demos but **not** representative of how real retries are deduped — those rely on Maileroo using a stable `message_id`.

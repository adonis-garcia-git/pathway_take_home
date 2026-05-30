// HTML body generator for outbound RFP emails. No React Email — plain template
// literal so this file stays a leaf with zero deps and is easy to unit test.
//
// We deliberately keep the markup tight and inline-styled because most email
// clients strip <style> blocks. The recipient sees:
//   • Restaurant header (name + address)
//   • One-sentence ask
//   • Ingredient table (raw name · estimated qty · unit)
//   • Quote deadline
//   • Reply instruction (reply-to address handles routing)

export interface RfpLine {
  rawName: string;
  estimatedQuantity: number;
  unit: string;
}

export interface RfpTemplateInput {
  restaurantName: string;
  restaurantAddress: string;
  distributorName: string;
  lines: RfpLine[];
  deadline: number; // epoch ms
}

const escapeHtml = (s: string): string =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const formatDeadline = (ts: number): string => {
  const d = new Date(ts);
  return d.toUTCString();
};

export function buildRfpHtml(input: RfpTemplateInput): string {
  const rows = input.lines
    .map(
      (l) => `
      <tr>
        <td style="padding:6px 12px;border-bottom:1px solid #eee;">${escapeHtml(l.rawName)}</td>
        <td style="padding:6px 12px;border-bottom:1px solid #eee;text-align:right;">${l.estimatedQuantity}</td>
        <td style="padding:6px 12px;border-bottom:1px solid #eee;">${escapeHtml(l.unit)}</td>
      </tr>`,
    )
    .join("");

  return `<!doctype html>
<html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#222;max-width:640px;margin:0 auto;padding:24px;">
  <p>Hi ${escapeHtml(input.distributorName)},</p>
  <p>This is Patty, the procurement assistant for <strong>${escapeHtml(input.restaurantName)}</strong> (${escapeHtml(input.restaurantAddress)}). We're requesting a quote on the items below — <strong>please reply to this email with your price per line by ${escapeHtml(formatDeadline(input.deadline))}.</strong></p>
  <table cellspacing="0" cellpadding="0" style="border-collapse:collapse;width:100%;margin:16px 0;font-size:14px;">
    <thead>
      <tr style="background:#f5f5f5;">
        <th style="padding:8px 12px;text-align:left;border-bottom:1px solid #ddd;">Item</th>
        <th style="padding:8px 12px;text-align:right;border-bottom:1px solid #ddd;">Est. Qty</th>
        <th style="padding:8px 12px;text-align:left;border-bottom:1px solid #ddd;">Unit</th>
      </tr>
    </thead>
    <tbody>${rows}
    </tbody>
  </table>
  <p style="color:#555;font-size:13px;">A reply in plain text is fine — our system will parse it. Thanks!</p>
  <p>— Patty, on behalf of ${escapeHtml(input.restaurantName)}</p>
</body></html>`;
}

export function buildRfpSubject(restaurantName: string): string {
  return `RFP — Weekly produce & dry goods for ${restaurantName}`;
}

// ── Follow-up templates (Phase 6) ────────────────────────────────

export interface MissingInfoTemplateInput {
  restaurantName: string;
  distributorName: string;
  missingLines: RfpLine[];
  deadline: number;
}

export function buildMissingInfoHtml(input: MissingInfoTemplateInput): string {
  const rows = input.missingLines
    .map(
      (l) => `
      <tr>
        <td style="padding:6px 12px;border-bottom:1px solid #eee;">${escapeHtml(l.rawName)}</td>
        <td style="padding:6px 12px;border-bottom:1px solid #eee;text-align:right;">${l.estimatedQuantity}</td>
        <td style="padding:6px 12px;border-bottom:1px solid #eee;">${escapeHtml(l.unit)}</td>
      </tr>`,
    )
    .join("");

  return `<!doctype html>
<html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#222;max-width:640px;margin:0 auto;padding:24px;">
  <p>Hi ${escapeHtml(input.distributorName)},</p>
  <p>Thanks for the partial quote. To finalize the award for <strong>${escapeHtml(input.restaurantName)}</strong>, we still need pricing on the items below. A one-line reply is plenty.</p>
  <table cellspacing="0" cellpadding="0" style="border-collapse:collapse;width:100%;margin:16px 0;font-size:14px;">
    <thead>
      <tr style="background:#f5f5f5;">
        <th style="padding:8px 12px;text-align:left;border-bottom:1px solid #ddd;">Item</th>
        <th style="padding:8px 12px;text-align:right;border-bottom:1px solid #ddd;">Est. Qty</th>
        <th style="padding:8px 12px;text-align:left;border-bottom:1px solid #ddd;">Unit</th>
      </tr>
    </thead>
    <tbody>${rows}
    </tbody>
  </table>
  <p>Please reply by ${escapeHtml(formatDeadline(input.deadline))}.</p>
  <p>— Patty</p>
</body></html>`;
}

export function buildMissingInfoSubject(restaurantName: string): string {
  return `Re: RFP — a few missing prices for ${restaurantName}`;
}

export interface NudgeTemplateInput {
  restaurantName: string;
  distributorName: string;
  deadline: number;
}

export function buildNudgeHtml(input: NudgeTemplateInput): string {
  return `<!doctype html>
<html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#222;max-width:640px;margin:0 auto;padding:24px;">
  <p>Hi ${escapeHtml(input.distributorName)},</p>
  <p>Quick nudge on the RFP for <strong>${escapeHtml(input.restaurantName)}</strong> — we haven't received a quote yet and the deadline is ${escapeHtml(formatDeadline(input.deadline))}. Even a partial reply or a "we can't fill this" is helpful for our award decision.</p>
  <p>— Patty</p>
</body></html>`;
}

export function buildNudgeSubject(restaurantName: string): string {
  return `Re: RFP — quick nudge for ${restaurantName}`;
}

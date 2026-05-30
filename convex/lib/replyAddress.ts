// Sub-address scheme used to route inbound Maileroo replies back to the
// originating rfpRecipient row. Mock distributors also get this address as
// their `distributors.email` so the catch-all loop works end-to-end.
// Single source of truth — do not inline the format string anywhere else.
export const replyAddressFor = (distributorId: string, mailDomain: string): string =>
  `distributor-${distributorId}@${mailDomain}`;

// Inverse: parse a "distributor-<id>@<domain>" address back to the distributorId.
// Returns null if the address doesn't match the scheme.
export const distributorIdFromReplyAddress = (address: string): string | null => {
  const match = address.match(/^distributor-([^@]+)@/);
  return match ? match[1] : null;
};

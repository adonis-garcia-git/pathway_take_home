// Typed env access for Convex actions. Convex actions read process.env at
// runtime; keys must be set in the Convex environment (`npx convex env set ...`),
// not just .env.local.
//
// Use `optional()` when missing env should trigger a documented fallback.
// Use `required()` only when missing env is a real configuration bug.
export const optional = (key: string): string | undefined => {
  const v = process.env[key];
  return v && v.length > 0 ? v : undefined;
};

export const required = (key: string): string => {
  const v = optional(key);
  if (!v) throw new Error(`Missing required env: ${key} (set with: npx convex env set ${key} ...)`);
  return v;
};

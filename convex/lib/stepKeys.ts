export const STEPS = [
  "parse_menu",
  "fetch_pricing",
  "find_distributors",
  "send_rfps",
  "collect_quotes",
] as const;

export type StepKey = (typeof STEPS)[number];

export function nextStep(step: StepKey): StepKey | null {
  const i = STEPS.indexOf(step);
  return i < 0 || i === STEPS.length - 1 ? null : STEPS[i + 1];
}

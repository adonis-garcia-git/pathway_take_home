// Single knob to compress the agent's timing for demos. Reads
// AGENT_TIME_SCALE from the Convex environment; defaults to 1.
//
// Set to 60 for a grader demo: 30-minute nudge becomes 30 seconds,
// 3-day deadline becomes ~72 minutes. Production stays at 1.
//
// Cron interval cannot be parameterized at runtime (cronJobs is
// declarative), so the heartbeat stays fixed at 5 minutes regardless.
// Demo runs lean on the self-scheduling path, which IS scaled.

import { optional } from "./env";

function scale(): number {
  const raw = optional("AGENT_TIME_SCALE");
  const n = raw ? Number(raw) : 1;
  return Number.isFinite(n) && n > 0 ? n : 1;
}

export const NUDGE_DELAY_MS = Math.round((30 * 60 * 1000) / scale());
export const RFP_DEADLINE_MS = Math.round((3 * 24 * 60 * 60 * 1000) / scale());
export const MAX_ATTEMPTS = 3;
export const BATCH_LIMIT = 10;

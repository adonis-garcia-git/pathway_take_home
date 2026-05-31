import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Cron-driven agent loop. Heartbeat every 5 minutes scans for missing-info
// follow-ups and no-reply nudges across all active runs.
crons.interval("agent-heartbeat", { minutes: 5 }, internal.agent.tick, {});

export default crons;

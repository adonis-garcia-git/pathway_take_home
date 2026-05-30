import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Autonomous agent loop: every 2 minutes, run the missing-info and no-reply
// scan passes. Both passes are idempotent and self-capped (see agent.ts), so
// it's safe to make the interval shorter for live demos.
crons.interval("agent-tick", { minutes: 2 }, internal.agent.tick, {});

export default crons;

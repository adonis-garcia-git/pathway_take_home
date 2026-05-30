// Headless one-command demo of the full RFP pipeline.
//
//   pnpm demo
//
// Requires NEXT_PUBLIC_CONVEX_URL to point at a running Convex deployment
// (e.g. via `npx convex dev` in another terminal, or `CONVEX_DEPLOYMENT` set).
//
// What it does, end-to-end:
//   1. Ensures the mock distributor catalog is seeded.
//   2. Idempotently seeds Frankies 457 Spuntino as the demo restaurant.
//   3. Kicks off the pipeline (parse_menu → … → collect_quotes).
//   4. Polls every 2s, logging each stage transition and final summary.
//   5. Prints the recommendation headline + savings; exits 0/1/2.

import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api.js";
import type { Id } from "../convex/_generated/dataModel.js";

const POLL_INTERVAL_MS = 2_000;
const MAX_DURATION_MS = 5 * 60 * 1000;

const STAGES = [
  "parse_menu",
  "fetch_pricing",
  "find_distributors",
  "send_rfps",
  "collect_quotes",
] as const;
type Stage = (typeof STAGES)[number];

function envOrExit(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`✗ Missing ${name}. Set it in your env (e.g. .env.local) and retry.`);
    process.exit(1);
  }
  return v;
}

async function main() {
  const url = envOrExit("NEXT_PUBLIC_CONVEX_URL");
  const client = new ConvexHttpClient(url);

  console.log("◆ Pathway · RFP Pipeline · headless demo");
  console.log(`  Convex deployment: ${url}`);

  // 1. Restaurant + menu + pipelineRun (idempotent).
  //    Mock distributor catalog is seeded by the find_distributors stage itself.
  console.log("\n→ Seeding Frankies 457 Spuntino…");
  const seed = (await client.mutation(api.seed.seedFrankies457, {})) as {
    restaurantId: Id<"restaurants">;
    menuId: Id<"menus">;
    runId: Id<"pipelineRuns">;
    wasResumed: boolean;
  };
  console.log(`  runId: ${seed.runId}${seed.wasResumed ? " (resumed)" : ""}`);

  // 3. Start the pipeline.
  console.log("\n→ Starting pipeline…");
  const start = (await client.mutation(api.pipelineRuns.startPipeline, { runId: seed.runId })) as {
    alreadyRunning: boolean;
  };
  console.log(`  ${start.alreadyRunning ? "(already running)" : "scheduled"}`);

  // 4. Poll for transitions.
  console.log("\n→ Watching live state (poll every 2s):");
  const seen = new Map<Stage, string>();
  const startedAt = Date.now();
  while (true) {
    if (Date.now() - startedAt > MAX_DURATION_MS) {
      console.error("\n✗ Timeout — pipeline still in flight after 5 min.");
      process.exit(2);
    }
    const run = await client.query(api.pipelineRuns.getPipelineRun, { runId: seed.runId });
    if (!run) {
      await sleep(POLL_INTERVAL_MS);
      continue;
    }
    for (const step of run.steps) {
      const key = step.step as Stage;
      const prev = seen.get(key);
      const cur = step.status;
      if (prev !== cur) {
        const tag = step.summary ?? step.error ?? "";
        console.log(`  ${pad(key)}  ${prev ?? "—"} → ${cur}${tag ? ` · ${tag}` : ""}`);
        seen.set(key, cur);
      }
    }
    if (run.currentStep === "done") break;
    if (run.currentStep === "error") {
      const failed = run.steps.find((s) => s.status === "error");
      console.error(`\n✗ Pipeline errored at ${failed?.step}: ${failed?.error ?? "unknown"}`);
      process.exit(1);
    }
    await sleep(POLL_INTERVAL_MS);
  }

  // 5. Print recommendation summary.
  console.log("\n→ Recommendation:");
  const rec = await client.query(api.recommendations.getForRun, { runId: seed.runId });
  if (!rec) {
    console.log("  (no recommendation generated — check that quotes landed)");
  } else {
    const r = rec.recommendation;
    console.log(`  Headline:   ${r.headline}`);
    console.log(`  Confidence: ${r.confidence}${r.needsHumanApproval ? " · NEEDS HUMAN APPROVAL" : ""}`);
    if (typeof r.estSavings === "number" && typeof r.estBaseline === "number") {
      console.log(`  Savings:    $${Math.round(r.estSavings)} of $${Math.round(r.estBaseline)} baseline`);
    }
    if (rec.primary) console.log(`  Primary:    ${rec.primary.name}`);
    if (rec.splits.length > 0) {
      console.log(`  Splits:`);
      for (const s of rec.splits) {
        console.log(`    · ${s.distributor?.name ?? "(unknown)"} — ${s.role} ($${Math.round(s.weeklyValue)}/wk)`);
      }
    }
    if (r.gaps.length > 0) {
      console.log(`  Gaps:       ${r.gaps.length} unquoted line${r.gaps.length === 1 ? "" : "s"}`);
    }
  }

  const totalSec = Math.round((Date.now() - startedAt) / 1000);
  console.log(`\n✓ Done in ${totalSec}s.`);
  process.exit(0);
}

function pad(s: string): string {
  return s.padEnd(18);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

main().catch((e) => {
  console.error("\n✗ Demo failed:", e);
  process.exit(1);
});

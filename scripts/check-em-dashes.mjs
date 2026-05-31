#!/usr/bin/env node
// Fails when an em dash (—, U+2014) appears in a user-facing source file.
//
// User-facing surface = anything that lands on screen, in an email body, in
// an LLM system prompt, or in a string the model can reach via tool-schema
// hints. Code comments (// and *) are skipped because they never reach users.
// See CLAUDE.md "Typography" for the project rule and rationale.

import { readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";
import { execSync } from "node:child_process";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

// Positive allow-list of paths the rule applies to. Anything not listed is
// out of scope (internal docs, tests, generated code, comments).
const SCOPE_GLOBS = [
  "app/*.ts",
  "app/*.tsx",
  "app/**/*.ts",
  "app/**/*.tsx",
  "components/*.ts",
  "components/*.tsx",
  "components/**/*.ts",
  "components/**/*.tsx",
  "convex/lib/rfpTemplate.ts",
  "convex/lib/anthropic.ts",
  "convex/lib/schemas.ts",
  "convex/lib/seedData.ts",
  "convex/lib/aggregate.ts",
  "convex/email.ts",
  "convex/seed.ts",
  "README.md",
];

const EM_DASH = "—";

function resolveScope() {
  // Use git ls-files so we honor .gitignore and don't traipse into node_modules.
  // Pass the globs to git; it'll expand them.
  let output;
  try {
    output = execSync(
      `git ls-files -- ${SCOPE_GLOBS.map((g) => JSON.stringify(g)).join(" ")}`,
      { cwd: repoRoot, encoding: "utf-8" },
    );
  } catch {
    return [];
  }
  return output
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((f) => !f.includes("__tests__/"))
    .filter((f) => {
      try {
        return statSync(join(repoRoot, f)).isFile();
      } catch {
        return false;
      }
    });
}

/**
 * True when the line is purely a comment (single-line or block-comment
 * continuation, JSX braced comment) and so exempt from the rule. We're
 * conservative: a line that has CODE followed by a trailing `//` comment
 * containing an em dash is still flagged, because the code half is what
 * surfaces in the UI.
 */
function isCommentOnly(line) {
  const t = line.trim();
  if (t.length === 0) return true;
  if (t.startsWith("//")) return true;
  if (t.startsWith("*")) return true; // JSDoc/block-comment continuation
  if (t.startsWith("/*")) return true;
  if (t.startsWith("{/*") && t.endsWith("*/}")) return true; // JSX braced comment
  return false;
}

/**
 * Opt-out: a line ending with `// allow-em-dash` is exempt. Reserved for
 * strings that must literally contain the character to talk ABOUT the rule
 * (e.g. the NO_EM_DASH_RULE constant fed to Claude).
 */
function hasAllowAnnotation(line) {
  return /\/\/\s*allow-em-dash\b/.test(line);
}

function check() {
  const files = resolveScope();
  const hits = [];
  for (const file of files) {
    const abs = join(repoRoot, file);
    let text;
    try {
      text = readFileSync(abs, "utf-8");
    } catch {
      continue;
    }
    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line.includes(EM_DASH)) continue;
      if (isCommentOnly(line)) continue;
      if (hasAllowAnnotation(line)) continue;
      hits.push({
        file: relative(repoRoot, abs),
        line: i + 1,
        text: line.trim(),
      });
    }
  }
  return hits;
}

const hits = check();
if (hits.length === 0) {
  process.exit(0);
}

console.error(
  `\n✖ ${hits.length} em-dash violation${hits.length === 1 ? "" : "s"} in user-facing code.`,
);
console.error(
  "  Em dashes (—) are banned in UI copy, emails, LLM prompts, and Zod .describe() hints.",
);
console.error("  Use periods (default), commas, semicolons, or colons. See CLAUDE.md “Typography”.\n");
for (const h of hits) {
  console.error(`  ${h.file}:${h.line}: ${h.text}`);
}
console.error("");
process.exit(1);

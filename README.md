# Pathway RFP Pipeline

An autonomous procurement agent ("mini-Patty") for restaurants. Parses a menu → prices the ingredient basket → finds local distributors → emails RFPs → monitors replies → recommends the best award. End-to-end programmatic; no manual steps.

Built with **Next.js 15 (App Router) + TypeScript + Tailwind v4 + Convex + Claude + Zod**.

## Quickstart

```bash
pnpm install
cp .env.example .env.local

# Convex (interactive: pick "create new project")
npx convex dev

# In another terminal:
pnpm dev
```

Then open <http://localhost:3000>.

Set every Convex-side key in the Convex environment too:

```bash
npx convex env set ANTHROPIC_API_KEY <key>
npx convex env set USDA_MARS_API_KEY <key>
npx convex env set MAILEROO_SENDING_KEY <key>
npx convex env set MAIL_DOMAIN <domain>
npx convex env set GOOGLE_PLACES_API_KEY <key>
```

## Docs

- **[CLAUDE.md](./CLAUDE.md)**: project doctrine: architecture, Convex patterns, coding conventions, glossary, definition-of-done.
- **[.env.example](./.env.example)**: every env var, where to get it, where it lives.
- **[design-reference/](./design-reference/)**: read-only design package: tokens, component spec, state vocabulary, seed data.

## Scripts

| Command              | What it does                            |
| -------------------- | --------------------------------------- |
| `pnpm dev`           | Next.js dev server                      |
| `pnpm build`         | Production build                        |
| `pnpm typecheck`     | `tsc --noEmit`, strict                  |
| `pnpm lint`          | ESLint (Next + Prettier)                |
| `pnpm convex:dev`    | Convex dev deployment + codegen watcher |

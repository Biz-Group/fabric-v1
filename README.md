# Fabric

Voice-first institutional knowledge capture for organizations. Contributors
describe how their work gets done in AI interviews, voice recordings, or audio
uploads. Fabric turns those conversations into process summaries, process
flows, and automation opportunities.

Stack: Next.js 16 (App Router, `src/app`), React 19, Convex (backend, in
`convex/`), Clerk (auth and organizations), ElevenLabs (voice agent), and
Microsoft Foundry (all AI calls).

## Getting started

```bash
npm install
cp .env.example .env.local   # fill in the public vars; server secrets go in Convex env
npx convex dev               # Convex backend + codegen
npm run dev                  # Next.js on http://localhost:3000
```

`.env.example` lists every variable, and says which ones are Convex environment
variables rather than client-side.

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` / `build` / `start` | Next.js dev server, production build, production server |
| `npm run lint` | ESLint |
| `npm test` | Vitest (Convex functions via `convex-test`, plus pure frontend modules) |
| `npm run foundry:smoke` / `foundry:throughput` | Foundry deployment checks |
| `npm run elevenlabs:charging` | ElevenLabs charging probe |
| `npm run flow-layout:spike` | Compare dagre and ELK layouts for process flows |

## Documentation

The product requirements, architecture overview, runbooks and design plans are
internal and live in a local `docs/` folder that is not committed. Code comments
that cite `docs/...` refer to those files.

[AGENTS.md](AGENTS.md) has notes for coding agents (Next.js 16 and Convex
guidelines).

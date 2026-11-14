# Sprint Orchestra Studio

The web frontend for Sprint Orchestra: a Jira-style workspace (spaces, backlog, board, timeline,
issues, code links) with the AI features built in — Ask AI, task drafting, Plan Epic, Sprint Pace,
Sprint Recovery, issue-level actions and the AI Feedback review page.

React + Vite + TypeScript. The backend services live in
[sprint-orchestra-core](https://github.com/michael23fire/sprint-orchestra-core).

## Setup

Requires Node.js 20+ and the backend stack running (`scripts/dev_up.sh` in sprint-orchestra-core).

```bash
npm install
npm run dev                  # http://localhost:5173
```

## Scripts

| Command | Description |
|--------|-------------|
| `npm run dev` | Vite dev server, also the API proxy |
| `npm run build` | Type check and production bundle → `dist/` |
| `npm run preview` | Serve `dist/` locally |
| `npm run lint` | ESLint |
| `npm run test:ui` | Unit tests in `tests/` |

## API routing

The SPA calls relative paths (`/api/...`, `/api/ai/...`). In development, the Vite server proxies them
(`vite.config.ts`): `/api/ai/*` goes to ai-service (`:8200`, prefix stripped), everything else under
`/api` and the GitHub OAuth paths go to jira-backend (`:8081`). Override the targets with
`JIRA_BACKEND_URL` / `AI_SERVICE_URL`. When deployed, CloudFront and an Application Load Balancer do
the same routing, so the browser only ever talks to one origin and no CORS setup is needed.

Leave `VITE_API_URL` unset unless a build is served from a different origin than its API; then set it
to that API origin before `npm run build`.

## Layout

| Path | Contents |
|------|----------|
| `src/pages/` | Routed pages (backlog, board, timeline, ticket detail, AI feedback, ...) |
| `src/components/` | Shared components, including the AI modals and the Ask AI panel |
| `src/api/` | API clients, including SSE streaming for AI endpoints |
| `src/context/` | User, space and ticket state |
| `tests/` | Unit tests for pure utilities (`tsx --test`) |

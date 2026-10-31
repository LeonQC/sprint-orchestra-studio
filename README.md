# Jira Agentic AI — Web (SPA)

Standalone **React + Vite + TypeScript** frontend for the Jira-style workspace UI (spaces, backlog, board, issues, etc.).  
This tree is a copy of `frontend/` from the full-stack **jira-agentic-ai** repo, kept at the **repository root** so you can version and deploy it separately.

## Prerequisites

- **Node.js 20+** and npm

## Setup

```bash
npm install
cp .env.example .env.local   # optional; edit API URL
npm run dev                  # http://localhost:5173
```

## Scripts

| Command | Description |
|--------|-------------|
| `npm run dev` | Vite dev server |
| `npm run build` | TypeScript check + production bundle → `dist/` |
| `npm run preview` | Serve `dist/` locally |
| `npm run lint` | ESLint |

## API URL

The SPA calls relative paths (`/api/...`, `/api/ai/...`) with `fetch`. In dev, the Vite server proxies
them (see `vite.config.ts`): `/api/ai/*` goes to ai-service (`:8200`, prefix stripped), everything else
under `/api` and the GitHub OAuth paths go to jira-backend (`:8081`). Override the targets with
`JIRA_BACKEND_URL` / `AI_SERVICE_URL`. When deployed, AWS API Gateway does the same routing.

Leave **`VITE_API_URL`** unset unless a build is served from a different origin than its API; then set
it to that API origin before `npm run build`.

## CORS

None needed: the browser only ever talks to one origin.

## Own Git repository

From this folder:

```bash
git init
git add .
git commit -m "Initial commit: SPA extracted from jira-agentic-ai"
git remote add origin <your-new-remote-url>
git push -u origin main
```

## Related repo

Backend (Java/Spring Boot), ai-service, database migrations, and Docker Compose live in the **sprint-orchestra-core** monorepo.

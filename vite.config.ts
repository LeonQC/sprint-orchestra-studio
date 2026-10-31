import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const JIRA_BACKEND = process.env.JIRA_BACKEND_URL ?? 'http://localhost:8081'
const AI_SERVICE = process.env.AI_SERVICE_URL ?? 'http://localhost:8200'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // The dev server is the one browser-facing origin, routing like CloudFront + ALB do when deployed.
    // Same origin, so no CORS. Entries are matched in order: /api/ai must come before /api.
    proxy: {
      '/api/ai': { target: AI_SERVICE, rewrite: (path) => path.replace(/^\/api\/ai/, '') },
      '/api': JIRA_BACKEND,
      // GitHub OAuth starts and finishes on jira-backend.
      '/oauth2': JIRA_BACKEND,
      '/login/oauth2': JIRA_BACKEND,
    },
  },
})

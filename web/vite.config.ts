import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// GitHub Pages serves a project page at https://<user>.github.io/<repo>/, so every
// asset path needs that /<repo>/ prefix -- but only for that one deployment
// target. Locally (`npm run dev` / a hand-run `npm run build`) there's no such
// prefix, so this defaults to '/' and only picks up BASE_PATH when the GitHub
// Actions workflow sets it (see .github/workflows/deploy.yml, which computes the
// right value for the repo it's actually running in -- nothing to hardcode here).
export default defineConfig({
  plugins: [react()],
  base: process.env.BASE_PATH || '/',
})

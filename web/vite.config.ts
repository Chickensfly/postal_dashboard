import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    // The catalog, previews and downloads all come from the FastAPI server on :8000.
    proxy: { '/api': 'http://127.0.0.1:8000' },
  },
})

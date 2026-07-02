import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Dev server proxies /api -> the stdlib Python API (server.py on :8000),
// so the browser talks to one origin and there are no CORS surprises.
export default defineConfig({
  plugins: [react()],
  server: {
    host: true, // listen on all interfaces so LAN devices can reach the dev server too
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:8000',
    },
  },
})

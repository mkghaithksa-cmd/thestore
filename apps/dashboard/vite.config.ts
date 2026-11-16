import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// The production build lives inside the store site under a hard-to-guess
// path (see DASHBOARD_BASE_PATH in @ghaith/shared); dev runs at "/".
const BASE_PATH = '/gh-ops-7k2/'

// https://vite.dev/config/
export default defineConfig(({ command }) => ({
  base: command === 'build' ? BASE_PATH : '/',
  plugins: [react()],
  server: { port: 5174, strictPort: true },
  preview: { port: 5174 },
}))

import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Required so asset paths work when the app is opened from a file:// URL (Electron production build).
  base: './',
})

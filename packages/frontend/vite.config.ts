import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 3000,
    proxy: {
      // Keep the browser's Host header so the API sees http://localhost:3000 as its origin.
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: false
      }
    }
  }
})

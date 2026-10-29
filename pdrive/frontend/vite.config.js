import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    }
  },
  // `npm run dev` talks to a locally running pdrive backend
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:9999',
      '/upload': 'http://127.0.0.1:9999',
      '/serve': 'http://127.0.0.1:9999',
      '/download': 'http://127.0.0.1:9999',
      // the event socket: everything that keeps moving arrives over it
      '/ws': { target: 'ws://127.0.0.1:9999', ws: true },
    }
  }
})

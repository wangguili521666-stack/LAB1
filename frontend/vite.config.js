import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],

  server: {
    host: '0.0.0.0',
    port: 5173,
    watch: { usePolling: process.env.VITE_USE_POLLING === 'true' },

    proxy: {
      '/api/d1': {
        target: process.env.D1_API_TARGET || 'http://localhost:3004',
        changeOrigin: true
      },
      '/api': {
        target: process.env.API_TARGET || 'http://localhost:8080',
        changeOrigin: true
      }
    }
  }
})
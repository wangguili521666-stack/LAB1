import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  cacheDir: ".local-logs/vite",

  server: {
    host: '0.0.0.0',
    port: 5173,
    watch: { usePolling: process.env.VITE_USE_POLLING === 'true' },

    proxy: {
      '/api/d1': {
        target: process.env.D1_API_TARGET || 'http://localhost:3004',
        changeOrigin: true
      },
      '/api/m2': {
        target: process.env.M2_API_TARGET || 'http://localhost:3002',
        changeOrigin: true
      },
      '/api/m1': { target: process.env.M1_API_TARGET || 'http://localhost:3001', changeOrigin: true },
      '/api/m3': { target: process.env.M3_API_TARGET || 'http://localhost:3003', changeOrigin: true },
      '/api/d2': { target: process.env.D2_API_TARGET || 'http://localhost:3005', changeOrigin: true },
      '/api/d3': { target: process.env.D3_API_TARGET || 'http://localhost:3006', changeOrigin: true },
      '/api': {
        target: process.env.API_TARGET || 'http://localhost:8080',
        changeOrigin: true
      }
    }
  }
})
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],

  server: {
    host: '0.0.0.0',
    port: 5173,

    proxy: {
      '/api/d1': {
        target: 'http://localhost:3004',
        changeOrigin: true
      },
      '/api': {
        target: 'http://localhost:8080',
        changeOrigin: true
      }
    }
  }
})
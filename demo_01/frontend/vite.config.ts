import path from 'path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// 开发时把 /api 代理到 FastAPI，前端只需请求同源 /api，避免跨域配置
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:8000', changeOrigin: true },
    },
  },
})

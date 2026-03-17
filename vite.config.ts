import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    allowedHosts: true,
    proxy: {
      // Agent endpoints → Python backend (app.py running on port 7860)
      '/api/agent': {
        target: 'http://localhost:7860',
        changeOrigin: true,
      },
      // Timetable sync → Python backend
      '/api/timetable': {
        target: 'http://localhost:7860',
        changeOrigin: true,
      },
      // Legacy raw AI proxy (kept as fallback)
      '/api/ai': {
        target: 'https://api-inference.modelscope.cn',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/ai/, '/v1'),
        secure: true,
      },
    },
  },
})

import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 阶段二上线 api/query.py 后，/api 请求经此代理转发到本地函数模拟端口
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
})

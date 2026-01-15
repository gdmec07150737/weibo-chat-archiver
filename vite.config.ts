
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    // 允许前端代码直接使用 process.env.API_KEY
    'process.env': {
      API_KEY: JSON.stringify(process.env.API_KEY || process.env.VITE_API_KEY || '')
    }
  },
  server: {
    port: 5173,
    open: true,
    // 解决本地开发时的跨域问题预检
    cors: true
  }
});

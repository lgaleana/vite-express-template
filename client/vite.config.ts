import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  envDir: './client',
  plugins: [
    react(),
    tailwindcss()
  ],
  server: {
    port: parseInt(process.env.VITE_FRONTEND_PORT),
    host: '0.0.0.0',
    strictPort: true,
    proxy: {
      '/api': {
        target: `${process.env.VITE_BACKEND_URL}`,
        changeOrigin: true
      }
    }
  }
})

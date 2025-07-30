import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  return {
    plugins: [
      react(),
      tailwindcss()
    ],
    server: {
      port: parseInt(env.VITE_FRONTEND_PORT),
      host: '0.0.0.0',
      strictPort: true,
      allowedHosts: ['api.buildpanel.ai'],
      proxy: {
        '/api': {
          target: `${env.VITE_BACKEND_URL}`,
          changeOrigin: true
        }
      }
    }
  }
})

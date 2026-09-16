import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Portas fora do padrão para não colidir com outros serviços da máquina.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 6471,
    strictPort: true,
    proxy: {
      '/api': { target: 'http://127.0.0.1:6472', changeOrigin: true },
      '/health': { target: 'http://127.0.0.1:6472', changeOrigin: true },
    },
  },
  // `npm run preview` serve o bundle de produção (o mesmo que a Vercel publica) apontando para a API local.
  preview: {
    port: 6470,
    strictPort: true,
    proxy: {
      '/api': { target: 'http://127.0.0.1:6472', changeOrigin: true },
      '/health': { target: 'http://127.0.0.1:6472', changeOrigin: true },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        // separa as bibliotecas pesadas para melhorar cache entre deploys
        manualChunks: {
          echarts: ['echarts', 'echarts/core', 'echarts/charts', 'echarts/components', 'echarts/renderers'],
          flow: ['@xyflow/react'],
          react: ['react', 'react-dom', 'react-router', '@tanstack/react-query'],
        },
      },
    },
  },
})

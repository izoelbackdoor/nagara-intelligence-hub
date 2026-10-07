import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  base: '/office/',
  plugins: [react()],
  build: { outDir: 'dist', assetsDir: 'assets', target: 'es2022' },
  server: {
    port: 3333,
    proxy: {
      '/ws': {
        target: 'ws://localhost:3334',
        ws: true,
      },
    },
  },
})

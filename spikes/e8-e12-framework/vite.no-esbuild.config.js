import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  esbuild: false,
  build: {
    assetsInlineLimit: 0,
    cssCodeSplit: false,
    minify: false,
    sourcemap: false,
  },
})

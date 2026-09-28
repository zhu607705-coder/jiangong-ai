import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

export default defineConfig({
  root: resolve('apps/workspace'), plugins: [react()],
  server: {
    // Windows-side editor writes on /mnt drives do not generate WSL2 inotify events.
    watch: process.platform === 'linux' && process.cwd().startsWith('/mnt/') ? { usePolling: true, interval: 500, ignored: ['**/data/local/**', '**/.cache/**', '**/output/**'] } : undefined,
    proxy: { '/api': `http://127.0.0.1:${process.env.PORT || 4310}`, '/_AMapService': `http://127.0.0.1:${process.env.PORT || 4310}`, '/health': `http://127.0.0.1:${process.env.PORT || 4310}` }, fs: { allow: [resolve('.')] }
  },
  build: { outDir: 'dist', emptyOutDir: true },
})

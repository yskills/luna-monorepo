import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    vue(),
    VitePWA({
      registerType: 'autoUpdate',
      workbox: {
        // API, Login und Status-Seite nie aus dem Service-Worker-Cache bedienen.
        navigateFallbackDenylist: [/^\/(assistant|auth|backend|health)(\/|$)/],
      },
      includeAssets: ['vite.svg'],
      manifest: {
        name: 'Personal Luna',
        short_name: 'Luna',
        description: 'Persönliche Luna Assistant App für alle Devices',
        theme_color: '#0b1020',
        background_color: '#0b1020',
        display: 'standalone',
        start_url: '/',
        icons: [
          {
            src: '/vite.svg',
            sizes: '192x192',
            type: 'image/svg+xml',
            purpose: 'any',
          },
          {
            src: '/vite.svg',
            sizes: '512x512',
            type: 'image/svg+xml',
            purpose: 'any',
          },
        ],
      },
    }),
  ],
  server: {
    host: '0.0.0.0',
    // changeOrigin bleibt aus: der Backend-CSRF-Schutz vergleicht Origin und Host.
    port: 5173,
    proxy: {
      '/assistant': {
        target: 'http://127.0.0.1:5050',
        changeOrigin: false,
      },
      '/auth': {
        target: 'http://127.0.0.1:5050',
        changeOrigin: false,
      },
      '/backend': {
        target: 'http://127.0.0.1:5050',
        changeOrigin: false,
      },
      '/health': {
        target: 'http://127.0.0.1:5050',
        changeOrigin: false,
      },
    },
  },
})

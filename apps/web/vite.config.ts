import vue from '@vitejs/plugin-vue';
import { VitePWA } from 'vite-plugin-pwa';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    vue(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'eShop 价格追踪',
        short_name: 'eShop 价格',
        description: '日服 Switch / Switch 2 折扣与价格历史',
        lang: 'zh-CN',
        theme_color: '#e60012',
        background_color: '#f6f6f4',
        display: 'standalone',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }
        ]
      },
      workbox: {
        // prices must come from the API, never a stale service-worker copy
        navigateFallbackDenylist: [/^\/v1\//],
        runtimeCaching: [{
          urlPattern: ({ url }) => url.hostname === 'img-eshop.cdn.nintendo.net',
          handler: 'CacheFirst',
          options: { cacheName: 'eshop-images', expiration: { maxEntries: 300, maxAgeSeconds: 30 * 24 * 3600 } }
        }]
      }
    })
  ],
  server: {
    proxy: { '/v1': { target: process.env.API_TARGET ?? 'http://127.0.0.1:3000', changeOrigin: true } }
  },
  test: { environment: 'happy-dom' }
});

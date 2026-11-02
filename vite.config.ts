import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      vue: 'vue/dist/vue.esm-bundler.js',
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // MV3 扩展只跑在 Chromium 上，原生支持 modulepreload，polyfill 是死重量。
    modulePreload: { polyfill: false },
    rollupOptions: {
      input: {
        popup: 'popup.html',
        options: 'options.html',
        demo: 'demo.html',
      },
      // 固定文件名（不带内容哈希）：便于内网 / 企业环境按文件名做加载白名单，
      // 也让升级后资源路径不变。扩展读本地文件、不走 HTTP 缓存，固定名不损失缓存收益。
      output: {
        entryFileNames: 'assets/[name].js',
        chunkFileNames: 'assets/[name].js',
        assetFileNames: 'assets/[name].[ext]',
      },
    },
  },
});

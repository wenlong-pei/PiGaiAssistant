import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import pkg from './package.json'

export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    outDir: 'dist/renderer',
    emptyOutDir: true,
    target: 'es2015',
    cssTarget: 'chrome80',
    rollupOptions: {
      output: {
        // 代码分割配置
        manualChunks: {
          // React 核心库
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          // MUI 组件库
          'vendor-mui': ['@mui/material', '@mui/icons-material', '@emotion/react', '@emotion/styled'],
          // 工具库（注意：原列表里的 'xlsx' 是死依赖——代码里从未导入，
          // 只有 exceljs 的 wb.xlsx API 被用到。它留在这里会让 rollup
          // 把它当入口模块去解析，移除依赖后直接报 Could not resolve entry module）
          'vendor-utils': ['jspdf', 'jspdf-autotable', 'dayjs', 'zustand', 'axios'],
          // 其他依赖
          'vendor-other': ['sql.js', 'uuid', 'lucide-react', 'react-hot-toast', 'driver.js', 'framer-motion']
        },
        // 确保 chunk 文件名包含 hash
        chunkFileNames: 'assets/js/[name]-[hash].js',
        entryFileNames: 'assets/js/[name]-[hash].js',
        assetFileNames: 'assets/[ext]/[name]-[hash].[ext]'
      },
      // 压缩配置
      treeshake: true
    },
    // 使用 esbuild 压缩（更快）
    minify: 'esbuild',
    esbuild: {
      drop: ['console', 'debugger'], // 生产环境移除 console 和 debugger
    },
    chunkSizeWarningLimit: 1000, // 提高 chunk 大小警告阈值
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  server: {
    port: 5173,
  },
  // 优化依赖预构建
  optimizeDeps: {
    include: ['react', 'react-dom', 'react-router-dom', '@mui/material', '@emotion/react'],
  },
})

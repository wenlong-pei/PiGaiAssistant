import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/tests/setup.ts'],
    // 覆盖渲染层(src) + 适配器/服务单元测试(test/unit) + 集成测试(test/integration)。
    // test/execution 需 node 环境 + playwright + electron stub，使用独立配置
    // (test/execution/vitest.exec.config.ts，见 package.json 的 test:exec)。
    include: [
      'src/**/*.{test,spec}.{js,ts,jsx,tsx}',
      'test/unit/**/*.{test,spec}.{js,ts,jsx,tsx}',
      'test/integration/**/*.{test,spec}.{js,ts,jsx,tsx}',
    ],
    exclude: [
      'node_modules/**',
      'dist/**',
      'release*/**',
      'test/execution/**',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'src/tests/',
        '**/*.d.ts',
        '**/*.config.*',
        '**/main.tsx',
      ],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      // Electron 主进程模块在测试环境无二进制，统一指向 stub（与 test:exec 保持一致）
      'electron': path.resolve(__dirname, './test/execution/electron-stub.ts'),
    },
  },
})

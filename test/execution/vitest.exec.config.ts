import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'node',
    // 仅纳入真正的执行用例（*.exec.test.ts）。
    // diag-config.test.ts / diag2.test.ts 为诊断脚本（无断言、有 console 噪声），
    // 不参与门禁（文件保留在磁盘上，供排查时手动运行）。
    include: ['test/execution/**/*.exec.test.ts'],
    testTimeout: 60000,
    hookTimeout: 60000,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      'electron': path.resolve(__dirname, './electron-stub.ts'),
    },
  },
})

import { defineConfig } from 'vitest/config'
export default defineConfig({ test: { include: ['tests/**/*.test.ts', 'vendor/dsh/packages/core/agent-loop/tests/tool-updates.spec.ts'], testTimeout: 15000, fileParallelism: false } })

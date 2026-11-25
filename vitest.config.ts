import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    exclude: ['tests/db/**'],
    setupFiles: ['tests/setup.ts'],
    coverage: { provider: 'v8', include: ['src/**', 'scripts/**'], reporter: ['text-summary', 'text'] },
  },
});

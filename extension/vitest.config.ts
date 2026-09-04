import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // The popup builds real DOM, so component tests need a document.
    environment: 'happy-dom',
    setupFiles: ['src/test-setup.ts'],
    include: ['src/**/*.test.ts'],
    globals: true
  }
});

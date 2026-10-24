import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    include: ['tests/**/*.test.{ts,tsx}'],
    // Engine tests run in Node; UI tests opt into jsdom with `// @vitest-environment jsdom`.
    environment: 'node',
  },
});

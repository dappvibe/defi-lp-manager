import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Use Node.js environment for testing
    environment: 'node',

    // Global test setup file
    setupFiles: ['./tests/setup.js'],

    // Test file patterns
    include: ['tests/**/*.test.js', 'tests/**/*.spec.js'],

    // Exclude node_modules and other directories
    exclude: ['node_modules/**', 'dist/**'],

    // Enable globals like describe, it, expect
    globals: true,

    // Coverage configuration
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/**',
        'tests/**',
        'vitest.config.js',
        '**/*.d.ts'
      ]
    },

    hookTimeout: 600000,
    testTimeout: 600000,

    // Pool options for better performance
    pool: 'threads',
    poolOptions: {
      threads: {
        singleThread: true
      }
    }
  }
});

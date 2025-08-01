/**
 * Global test setup file
 * Runs before all tests to initialize the test environment
 */
const { connectTestDB, disconnectTestDB, clearTestDB } = require('./database');

// Setup global test environment
beforeAll(async () => {
  console.log('Test environment initialized');
});

// Cleanup after all tests
afterAll(async () => {
  // Disconnect from in-memory MongoDB
  await disconnectTestDB();
  console.log('Test environment cleaned up');
});

// Clear database between each test to ensure test isolation
beforeEach(async () => {
  await clearTestDB();
});

// Global test utilities available in all tests
global.testUtils = {
  // Re-export database utilities for convenience
  clearTestDB,

  // Helper to wait for async operations
  wait: (ms) => new Promise(resolve => setTimeout(resolve, ms)),

  // Helper to create test data
  createTestData: {
    pool: (overrides = {}) => ({
      address: '0x1234567890123456789012345678901234567890',
      token0: '0xA0b86a33E6441e6e80D0c4C34F0b0B2e0c0d0e0f',
      token1: '0xB0b86a33E6441e6e80D0c4C34F0b0B2e0c0d0e0f',
      fee: 3000,
      liquidity: '1000000000000000000',
      ...overrides
    }),

    token: (overrides = {}) => ({
      address: '0xA0b86a33E6441e6e80D0c4C34F0b0B2e0c0d0e0f',
      symbol: 'TEST',
      name: 'Test Token',
      decimals: 18,
      ...overrides
    })
  }
};

// Suppress console logs during tests unless explicitly needed
if (process.env.NODE_ENV === 'test') {
  console.log = vi.fn();
  console.warn = vi.fn();
  console.error = vi.fn();
}

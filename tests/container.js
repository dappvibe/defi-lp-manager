/**
 * Test container utilities for mocking awilix services
 * Provides easy ways to create test containers with mocked services
 */
const awilix = require('awilix');
const { getTestDBUri } = require('./database');
const createAppContainer = require('../src/container');

/**
 * Create a test container with default test configuration
 * @param {Object} mocks - Object containing service mocks to override
 * @returns {awilix.AwilixContainer} Test container with mocked services
 */
function createTestContainer(mocks = {}) {
  const container = createAppContainer({
    db: {
      uri: getTestDBUri()
    },
    telegram: {
      botToken: 'disabled',
    }
  });

  // Apply additional mocks
  if (mocks) {
    container.register(mocks);
  }

  return container;
}

/**
 * Create a mock service function
 * @param {Object} methods - Methods to mock on the service
 * @returns {Object} Mocked service object
 */
function createMockService(methods = {}) {
  const mockService = {};

  for (const [methodName, implementation] of Object.entries(methods)) {
    if (typeof implementation === 'function') {
      mockService[methodName] = vi.fn(implementation);
    } else {
      mockService[methodName] = vi.fn().mockResolvedValue(implementation);
    }
  }

  return mockService;
}

/**
 * Mock a specific service in the container
 * @param {awilix.AwilixContainer} container - The container to modify
 * @param {string} serviceName - Name of the service to mock
 * @param {Object} mockImplementation - Mock implementation
 */
function mockService(container, serviceName, mockImplementation) {
  container.register({
    [serviceName]: awilix.asValue(mockImplementation)
  });
}

/**
 * Get all registered service names from container
 * @param {awilix.AwilixContainer} container - The container to inspect
 * @returns {string[]} Array of service names
 */
function getRegisteredServices(container) {
  return Object.keys(container.registrations);
}

/**
 * Reset all mocks in a container (if using vitest mocks)
 * @param {awilix.AwilixContainer} container - The container with mocked services
 */
function resetContainerMocks(container) {
  const services = getRegisteredServices(container);

  services.forEach(serviceName => {
    try {
      const service = container.resolve(serviceName);
      if (service && typeof service === 'object') {
        Object.values(service).forEach(method => {
          if (method && typeof method.mockReset === 'function') {
            method.mockReset();
          }
        });
      }
    } catch (error) {
      // Ignore resolution errors for optional services
    }
  });
}

module.exports = {
  createTestContainer,
  createMockService,
  mockService,
  getRegisteredServices,
  resetContainerMocks
};

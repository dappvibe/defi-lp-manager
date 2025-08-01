/**
 * Test database configuration using MongoDB Memory Server
 * Provides in-memory MongoDB instance for all tests
 */
const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');

let mongoServer;

/**
 * Connect to in-memory MongoDB instance
 * @returns {Promise<void>}
 */
async function connectTestDB() {
  // Create in-memory MongoDB instance
  mongoServer = await MongoMemoryServer.create({
    instance: {
      dbName: 'test-defi-lp-manager'
    }
  });

  const mongoUri = mongoServer.getUri();

  console.log('Connected to in-memory MongoDB for testing');
}

/**
 * Disconnect and stop the in-memory MongoDB instance
 * @returns {Promise<void>}
 */
async function disconnectTestDB() {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }

  if (mongoServer) {
    await mongoServer.stop();
  }

  console.log('Disconnected from in-memory MongoDB');
}

/**
 * Clear all data from the test database
 * @returns {Promise<void>}
 */
async function clearTestDB() {
  if (mongoose.connection.readyState !== 0) {
    const collections = mongoose.connection.collections;

    for (const key in collections) {
      const collection = collections[key];
      await collection.deleteMany({});
    }
  }
}

/**
 * Get the test database URI
 * @returns {string|null}
 */
function getTestDBUri() {
  return mongoServer ? mongoServer.getUri() : null;
}

module.exports = {
  connectTestDB,
  disconnectTestDB,
  clearTestDB,
  getTestDBUri
};

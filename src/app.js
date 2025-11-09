/**
 * Main application module
 * Contains core application logic and initialization
 */

/**
 * Initialize the application
 * @returns {Object} Application context with initialized services
 */
async function startApp() {
  const container = require('./container')();
  const config = container.resolve('config');

  const db = container.resolve('mongoose');
  await db.connect(config.db.uri).then(() => console.log('Connected to MongoDB'));

  const provider = container.resolve('provider');
  const telegram = container.resolve('telegram');

  return {
    container,
    provider,
    telegram,
    db,
  };
}

/**
 * Clean up application resources
 * @param {Object} appContext - The application context with services to clean up
 */
async function cleanupApp(appContext) {
  const { bot, mongoose } = appContext;

  // Close MongoDB connection if available
  if (mongoose) {
    await mongoose.disconnect();
  }

  // Bot shutdown
  if (bot && typeof bot.shutdown === 'function') {
    await bot.shutdown();
  }
}

module.exports = {
  startApp,
  cleanupApp,
};

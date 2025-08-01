/**
 * Main application module
 * Contains core application logic and initialization
 */

/**
 * Initialize the application
 * @returns {Object} Application context with initialized services
 */
async function startApp() {
    // Create and configure the dependency injection container
    const container = require('./container')();

    const config = container.resolve('config');

    // Connect to database
    const db = container.resolve('mongoose');
    await db.connect(config.db.uri);

    // Get other services from container
    const provider = container.resolve('provider');
    const bot = container.resolve('bot');

    return {
        container,
        provider,
        bot,
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

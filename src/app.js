/**
 * Main application module
 * Contains core application logic and initialization
 */
const { environment } = require('./config');
const { getProvider } = require('./services/blockchain/provider');
const poolMonitor = require('./services/uniswap/pool-monitor');
const initTelegramBot = require('./services/telegram/bot');
const PositionMonitor = require('./services/uniswap/position-monitor');
const MongoStateManager = require('./services/database/mongo');

/**
 * Initialize the application
 * @returns {Object} Application context with initialized services
 */
async function initializeApp() {
    // Initialize services
    const provider = getProvider();

    // Initialize MongoDB state manager
    const mongoStateManager = new MongoStateManager();
    await mongoStateManager.connect();

    // Initialize position monitor for wallet tracking with state manager
    const positionMonitor = new PositionMonitor(provider, mongoStateManager);

    // Restore position monitor state from MongoDB
    await positionMonitor.initialize();

    // Initialize the Telegram bot with the pool monitor and position monitor
    const bot = initTelegramBot(
        environment.telegram.botToken,
        provider,
        poolMonitor.getMonitoredPools(),
        positionMonitor,
        environment.telegram.timezone
    );

    // Initialize pool monitor with MongoDB state restoration
    // This must be done after the bot is initialized since it needs the bot instance
    await poolMonitor.initialize(bot, provider, environment.telegram.timezone);

    return {
        provider,
        bot,
        poolMonitor,
        positionMonitor,
        mongoStateManager,
    };
}

/**
 * Clean up application resources
 * @param {Object} appContext - The application context with services to clean up
 */
async function cleanupApp(appContext) {
    const { bot, poolMonitor, mongoStateManager } = appContext;

    // Stop database all pools
    await poolMonitor.stopAllMonitoring();

    // Close MongoDB connection if available
    if (mongoStateManager) {
        await mongoStateManager.close();
    }

    // Stop the Telegram bot
    if (bot && typeof bot.stopPolling === 'function') {
        bot.stopPolling();
    }
}

module.exports = {
    initializeApp,
    cleanupApp,
};

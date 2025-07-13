/**
 * Main application module
 * Contains core application logic and initialization
 */
const { environment } = require('./config');
const { getProvider } = require('./services/blockchain/provider');
const poolService = require('./services/uniswap/pool');
const Bot = require('./services/telegram/bot');
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

    // Initialize pool service
    await poolService.initialize();

    // Initialize position monitor for wallet tracking with state manager
    const positionMonitor = new PositionMonitor(provider, mongoStateManager);

    // Initialize the Bot with the pool service and position monitor
    const bot = new Bot(
        environment.telegram.botToken,
        provider,
        poolService.getMonitoredPools(),
        positionMonitor
    );

    // Initialize pool service with monitoring functionality
    // This must be done after the bot is initialized since it needs the bot instance
    await poolService.initialize(bot, provider);

    return {
        provider,
        bot,
        poolService,
        positionMonitor,
        mongoStateManager,
    };
}

/**
 * Clean up application resources
 * @param {Object} appContext - The application context with services to clean up
 */
async function cleanupApp(appContext) {
    const { bot, poolService, mongoStateManager } = appContext;

    // Close pool service (includes stopping all monitoring)
    if (poolService) {
        await poolService.close();
    }

    // Close MongoDB connection if available
    if (mongoStateManager) {
        await mongoStateManager.close();
    }

    // Bot shutdown
    if (bot && typeof bot.shutdown === 'function') {
        await bot.shutdown();
    }
}

module.exports = {
    initializeApp,
    cleanupApp,
};

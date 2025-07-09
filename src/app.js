/**
 * Main application module
 * Contains core application logic and initialization
 */
const { environment } = require('./config');
const { getProvider } = require('./services/blockchain/provider');
const poolMonitor = require('./services/monitoring/pool-monitor');
const initTelegramBot = require('./services/telegram/bot');

/**
 * Initialize the application
 * @returns {Object} Application context with initialized services
 */
async function initializeApp() {
    // Initialize services
    const provider = getProvider();

    // Initialize the Telegram bot with the pool monitor
    const bot = initTelegramBot(
        environment.telegram.botToken,
        provider,
        poolMonitor.getMonitoredPools(),
        environment.telegram.timezone
    );

    // Initialize pool monitor with MongoDB state restoration
    // This must be done after the bot is initialized since it needs the bot instance
    await poolMonitor.initialize(bot, provider, environment.telegram.timezone);

    return {
        provider,
        bot,
        poolMonitor,
    };
}

/**
 * Clean up application resources
 * @param {Object} appContext - The application context with services to clean up
 */
async function cleanupApp(appContext) {
    const { bot, poolMonitor } = appContext;

    // Stop monitoring all pools (this will also close MongoDB connection)
    await poolMonitor.stopAllMonitoring();

    // Stop the Telegram bot
    if (bot && typeof bot.stopPolling === 'function') {
        bot.stopPolling();
    }
}

module.exports = {
    initializeApp,
    cleanupApp,
};

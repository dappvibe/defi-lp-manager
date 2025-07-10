/**
 * Telegram Bot Service
 * Main bot initialization and message handling
 */
const TelegramBot = require('node-telegram-bot-api');
const { environment } = require('../../config');
const { handleStart, NotifyHandler, PoolHandler, WalletHandler } = require('./handlers');

const Throttler = require('../../utils/throttler');

/**
 * Initialize the Telegram bot with all handlers
 * @param {string} token - Telegram bot token
 * @param {object} provider - Ethereum provider instance
 * @param {object} monitoredPools - Object to store monitored pools
 * @param {object} positionMonitor - Position monitor instance
 * @param {string} timezone - Timezone for time display
 * @returns {TelegramBot} - Initialized bot instance
 */
function initTelegramBot(token, provider, monitoredPools, positionMonitor, timezone) {
  // Create the bot with standard options
  const bot = new TelegramBot(token, { polling: true });

  // Add throttling capabilities
  const rateLimit = environment.telegram.rateLimit;
  const throttler = new Throttler({
    maxRequests: rateLimit.maxRequestsPerSecond,
    timeWindowMs: 1000
  });

  // Track last edit time for messages
  const lastEditTimes = {};

  // Override bot methods with throttled versions
  const originalSendMessage = bot.sendMessage;
  bot.sendMessage = async function(chatId, text, options = {}) {
    return throttler.throttle(() => originalSendMessage.call(bot, chatId, text, options));
  };

  const originalEditMessageText = bot.editMessageText;
  bot.editMessageText = async function(text, options = {}) {
    const messageKey = `${options.chat_id || ''}_${options.message_id || ''}`;
    const now = Date.now();
    const lastEdit = lastEditTimes[messageKey] || 0;

    // Calculate delay needed to respect minimum time between edits
    const timeSinceLastEdit = now - lastEdit;
    const delayNeeded = Math.max(0, rateLimit.messageEditDelay - timeSinceLastEdit);

    // Check if this is a price update message by looking for specific patterns
    // Price updates contain "Tick:" and "Last Swap:" which are unique identifiers
    const isPriceUpdate = text.includes('Tick:') && text.includes('Last Swap:');

    // If this is a price update that would be throttled, discard it
    if (isPriceUpdate && delayNeeded > 0) {
      // Return a resolved promise to maintain interface consistency
      return Promise.resolve({ message_id: options.message_id });
    }

    // For non-price updates, wait for the required delay
    if (delayNeeded > 0) {
      await new Promise(resolve => setTimeout(resolve, delayNeeded));
    }

    // Update last edit time and throttle the API call
    lastEditTimes[messageKey] = Date.now();
    return throttler.throttle(() => originalEditMessageText.call(bot, text, options));
  };

  const originalAnswerCallbackQuery = bot.answerCallbackQuery;
  bot.answerCallbackQuery = async function(callbackQueryId, options = {}) {
    return throttler.throttle(() => originalAnswerCallbackQuery.call(bot, callbackQueryId, options));
  };

  const originalSendPhoto = bot.sendPhoto;
  bot.sendPhoto = async function(chatId, photo, options = {}) {
    return throttler.throttle(() => originalSendPhoto.call(bot, chatId, photo, options));
  };

  // Log events
  bot.on('polling_start', () => console.log('Telegram Bot started polling'));
  bot.on('polling_error', (error) => console.error('Telegram Bot polling error:', error));

  // Create handler instances with their dependencies
  const notifyHandler = new NotifyHandler();
  const poolHandler = new PoolHandler(provider, monitoredPools, timezone);
  const walletHandler = new WalletHandler(positionMonitor, timezone);

  // Command handlers
  bot.onText(/\/start/, (msg) => {
    handleStart(bot, msg);
  });

  bot.onText(/\/notify (.+)/, (msg, match) => {
    notifyHandler.handle(bot, msg, match, monitoredPools, timezone);
  });

  // Pool monitoring commands
  bot.onText(/\/pool(?:\s+(.+))?/, (msg, match) => {
    poolHandler.handle(bot, msg, match);
  });

  bot.onText(/\/stop_pool(?:\s+(.+))?/, (msg, match) => {
    poolHandler.handleStopPool(bot, msg, match);
  });

  bot.onText(/\/list_pools/, (msg) => {
    poolHandler.handleListPools(bot, msg);
  });

  // Wallet position monitoring commands
  bot.onText(/\/wallet(?:\s+(.+))?/, (msg, match) => {
    walletHandler.handle(bot, msg, match);
  });

  bot.onText(/\/stop_wallet(?:\s+(.+))?/, (msg, match) => {
    walletHandler.handleStopWallet(bot, msg, match);
  });

  bot.onText(/\/list_wallets/, (msg) => {
    walletHandler.handleListWallets(bot, msg);
  });

  return bot;
}

module.exports = initTelegramBot;

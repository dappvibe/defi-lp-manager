/**
 * Telegram Bot Service
 * Main bot initialization and message handling
 */
const TelegramBot = require('node-telegram-bot-api');
const { environment } = require('../../config');
const handlers = require('./handlers');
const { isValidEthereumAddress } = require('../blockchain/price-calculator');
const Throttler = require('../../utils/throttler');

/**
 * Initialize the Telegram bot with all handlers
 * @param {string} token - Telegram bot token
 * @param {object} provider - Ethereum provider instance
 * @param {object} monitoredPools - Object to store monitored pools
 * @param {string} timezone - Timezone for time display
 * @returns {TelegramBot} - Initialized bot instance
 */
function initTelegramBot(token, provider, monitoredPools, timezone) {
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

  // Command handlers
  bot.onText(/\/start/, (msg) => {
    handlers.handleStart(bot, msg);
  });

  bot.onText(/\/notify (.+)/, (msg, match) => {
    handlers.handleNotify(bot, msg, match, monitoredPools, timezone);
  });

  // Handle address messages
  bot.on('message', async (msg) => {
    const messageText = msg.text;
    if (!messageText) return; // Handle cases where messageText might be null or undefined

    // Ignore commands that are already handled by onText or other specific handlers
    if (messageText.startsWith('/')) return;

    if (isValidEthereumAddress(messageText)) {
      await handlers.handleMonitorAddress(bot, msg, provider, monitoredPools, timezone);
    } else {
      // Check if it's a reply to a specific message, or some other non-address text
      // For now, keep the generic message if it's not an address and not a command
      if (!msg.reply_to_message) {
        bot.sendMessage(msg.chat.id, "Send a valid Ethereum pool contract address to monitor, or use /notify <price> for alerts.");
      }
    }
  });

  return bot;
}

module.exports = initTelegramBot;

/**
 * Telegram Bot Service
 * Main bot initialization and message handling
 */
const TelegramBot = require('node-telegram-bot-api');
const { environment } = require('../../config');
const handlers = require('./handlers');
const { isValidEthereumAddress } = require('../blockchain/price-calculator');

/**
 * Initialize the Telegram bot with all handlers
 * @param {string} token - Telegram bot token
 * @param {object} provider - Ethereum provider instance
 * @param {object} monitoredPools - Object to store monitored pools
 * @param {string} timezone - Timezone for time display
 * @returns {TelegramBot} - Initialized bot instance
 */
function initTelegramBot(token, provider, monitoredPools, timezone) {
  const bot = new TelegramBot(token, { polling: true });

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

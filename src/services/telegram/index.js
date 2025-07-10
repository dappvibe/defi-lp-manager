/**
 * Telegram service module
 * Exports all Telegram-related functionality
 */
const bot = require('./bot');
const handlers = require('./commands');

module.exports = {
  initTelegramBot: bot,
  handlers
};

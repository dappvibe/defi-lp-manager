/**
 * Handler for /start command
 * Sends welcome message to the user
 * @param {TelegramBot} bot - The bot instance
 * @param {Object} msg - Message object from Telegram
 */
function handleStart(bot, msg) {
  bot.sendMessage(msg.chat.id, "Send a Uniswap v3 pool contract address to monitor its price. Use /notify <price> to set a price alert for monitored pools in this chat.");
}

module.exports = handleStart;

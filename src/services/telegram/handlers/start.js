/**
 * Handler for /start command
 * Sends welcome message to the user
 */
class StartHandler {
  /**
   * Register command handlers with the bot
   * @param {TelegramBot} bot - The bot instance
   */
  static onText(bot) {
    bot.onText(/\/start/, (msg) => {
      this.handle(bot, msg);
    });
  }

  /**
   * Handle start command
   * @param {TelegramBot} bot - The bot instance
   * @param {Object} msg - Message object from Telegram
   */
  static handle(bot, msg) {
    bot.sendMessage(msg.chat.id, "Send a Uniswap v3 pool contract address to monitor its price. Use /notify <price> to set a price alert for monitored pools in this chat.");
  }

  /**
   * Returns a brief help description with command signature
   * @returns {string} One-line help text
   */
  static help() {
    return "/start - Begin using the bot and see welcome message";
  }
}

module.exports = StartHandler;

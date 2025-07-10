/**
 * Handler for /start command
 * Sends welcome message to the user and shows current monitoring status
 */
class StartHandler {
  /**
   * Register command handlers with the bot
   * @param {TelegramBot} bot - The bot instance
   * @param {Object} monitoredPools - Object containing monitored pools
   * @param {Object} positionMonitor - Position monitor instance
   */
  static onText(bot, monitoredPools, positionMonitor) {
    bot.onText(/\/start/, (msg) => {
      this.handle(bot, msg, monitoredPools, positionMonitor);
    });
  }

  /**
   * Handle start command
   * @param {TelegramBot} bot - The bot instance
   * @param {Object} msg - Message object from Telegram
   * @param {Object} monitoredPools - Object containing monitored pools
   * @param {Object} positionMonitor - Position monitor instance
   */
  static async handle(bot, msg, monitoredPools, positionMonitor) {
    const chatId = msg.chat.id;

    // Welcome message
    let message = "🤖 **DeFi LP Manager Bot**\n\n";
    message += "Use /notify <price> to set a price alert for monitored pools in this chat.\n\n";

    // Show current monitoring status
    message += "📊 **Current Monitoring Status:**\n\n";

    // Show monitored pools for this chat
    const poolsInChat = Object.entries(monitoredPools).filter(
      ([_, poolData]) => poolData.chatId === chatId
    );

    if (poolsInChat.length > 0) {
      message += `🏊 **Pools (${poolsInChat.length}):**\n`;
      poolsInChat.forEach(([address, data], idx) => {
        const pair = `${data.token1?.symbol || '???'}/${data.token0?.symbol || '???'}`;
        const price = data.lastPriceT1T0 ? data.lastPriceT1T0.toFixed(8) : 'N/A';
        message += `${idx + 1}. ${pair} - ${price}\n`;
        message += `   \`${address}\`\n`;
      });
      message += "\n";
    } else {
      message += "🏊 **Pools:** None monitored in this chat\n\n";
    }

    // Show monitored wallets (global)
    const monitoredWallets = positionMonitor.getMonitoredWallets();
    if (monitoredWallets.length > 0) {
      message += `💼 **Wallets (${monitoredWallets.length}):**\n`;
      monitoredWallets.forEach((addr, idx) => {
        message += `${idx + 1}. \`${addr}\`\n`;
      });
      message += "\n";
    } else {
      message += "💼 **Wallets:** None monitored\n\n";
    }

    message += "Use /help for available commands.";

    await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
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

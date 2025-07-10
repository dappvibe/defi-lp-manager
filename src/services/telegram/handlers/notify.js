/**
 * Handler for /notify command
 * Sets price alerts for monitored pools
 * Usage: /notify price [pool]
 */
class NotifyHandler {
  /**
   * Handle notify command to set price alerts
   * @param {TelegramBot} bot - The bot instance
   * @param {Object} msg - Message object from Telegram
   * @param {Array} match - Regex match array containing the command params
   * @param {Object} monitoredPools - Object containing monitored pools
   */
  static async handle(bot, msg, match, monitoredPools) {
    const chatId = msg.chat.id;
    const params = match[1].trim().split(/\s+/);

    // Check if we have any pools monitored in this chat
    const poolsInChat = Object.entries(monitoredPools).filter(
        ([_, poolData]) => poolData.chatId === chatId
    );

    if (poolsInChat.length === 0) {
      await bot.sendMessage(chatId, "No pools are currently being monitored in this chat. Send a pool address first.");
      return;
    }

    // Handle both formats: "/notify <price>" and "/notify <price> <pool_address>"
    let targetPrice, poolAddress;

    if (params.length === 1) {
      // Format: "/notify <price>" - applies to all pools in the chat
      await this.handleNotifyAllPools(bot, chatId, params[0], poolsInChat);
    } else if (params.length === 2) {
      // Format: "/notify <price> <pool_address>"
      targetPrice = parseFloat(params[0]);
      poolAddress = params[1];
      await this.handleNotifySpecificPool(bot, chatId, poolAddress, targetPrice, monitoredPools);
    } else {
      await bot.sendMessage(chatId, "Invalid format. Use /notify <price> or /notify <price> <pool_address>");
    }
  }

  /**
   * Returns a brief help description with command signature
   * @returns {string} One-line help text
   */
  static help() {
    return "/notify <price> [pool] - Set price alerts for monitored pools";
  }

  /**
   * Returns usage information for the notify command
   * @returns {string} Help text for humans
   */
  static usage() {
    return `🔔 **Notify Command Help**

**Usage:**
\`/notify <price>\` - Set price alert for ALL monitored pools in this chat
\`/notify <price> <pool_address>\` - Set price alert for specific pool

**Examples:**
\`/notify 0.0025\` - Alert when any pool reaches 0.0025
\`/notify 1.5 0x123...\` - Alert when specific pool reaches 1.5

**Notes:**
• You must have pools monitored in this chat first
• Price alerts will notify you when the target price is reached
• You can set multiple alerts for the same pool
• Alerts are one-time notifications and will be removed after triggering

**Related Commands:**
• Send a pool address to start monitoring
• \`/wallet\` - Monitor wallet positions instead`;
  }

  /**
   * Handle setting notifications for all pools in chat
   * @param {TelegramBot} bot - The bot instance
   * @param {number} chatId - Chat ID
   * @param {string} priceParam - Price parameter from command
   * @param {Array} poolsInChat - Array of pools in the chat
   */
  static async handleNotifyAllPools(bot, chatId, priceParam, poolsInChat) {
    const targetPrice = parseFloat(priceParam);

    if (isNaN(targetPrice)) {
      await bot.sendMessage(chatId, "Invalid price format. Use /notify <price> or /notify <price> <pool_address>");
      return;
    }

    // Apply to all pools in this chat
    let notificationsSet = 0;

    for (const [, poolData] of poolsInChat) {
      if (poolData.lastPriceT1T0) {
        if (!poolData.notifications) {
          poolData.notifications = [];
        }

        poolData.notifications.push({
          targetPrice,
          originalChatId: chatId,
          triggered: false
        });

        notificationsSet++;
      }
    }

    if (notificationsSet > 0) {
      await bot.sendMessage(
          chatId,
          `Price alert set at ${targetPrice} for ${notificationsSet} pool(s) in this chat.`
      );
    } else {
      await bot.sendMessage(
          chatId,
          "Could not set notifications. Make sure pools are properly initialized."
      );
    }
  }

  /**
   * Handle setting notification for a specific pool
   * @param {TelegramBot} bot - The bot instance
   * @param {number} chatId - Chat ID
   * @param {string} poolAddress - Pool address
   * @param {number} targetPrice - Target price for notification
   * @param {Object} monitoredPools - Object containing monitored pools
   */
  static async handleNotifySpecificPool(bot, chatId, poolAddress, targetPrice, monitoredPools) {
    if (isNaN(targetPrice)) {
      await bot.sendMessage(chatId, "Invalid price format. Use /notify <price> or /notify <price> <pool_address>");
      return;
    }

    // Check if the specified pool is being monitored
    if (!monitoredPools[poolAddress] || monitoredPools[poolAddress].chatId !== chatId) {
      await bot.sendMessage(chatId, `Pool ${poolAddress} is not monitored in this chat.`);
      return;
    }

    const poolInfo = monitoredPools[poolAddress];

    if (!poolInfo.lastPriceT1T0) {
      await bot.sendMessage(chatId, `Pool ${poolAddress} is not initialized yet or price data is not available.`);
      return;
    }

    if (!poolInfo.notifications) {
      poolInfo.notifications = [];
    }

    poolInfo.notifications.push({
      targetPrice,
      originalChatId: chatId,
      triggered: false
    });

    await bot.sendMessage(
        chatId,
        `Price alert set at ${targetPrice} for ${poolInfo.token1.symbol}/${poolInfo.token0.symbol} pool.`
    );
  }
}

module.exports = NotifyHandler;

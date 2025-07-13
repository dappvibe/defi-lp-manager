/**
 * Handler for /notify command
 * Sets price alerts for monitored pools
 * Usage: /notify price [pool]
 */

/**
 * Represents a no pools monitored message
 */
class NoPoolsMonitoredMessage {
  /**
   * Get the formatted message content
   * @returns {string} The no pools message
   */
  toString() {
    return "No pools are currently being monitored in this chat. Use /pool <address> to start monitoring a pool first.";
  }
}

/**
 * Represents an invalid format message
 */
class InvalidFormatMessage {
  /**
   * Get the formatted message content
   * @returns {string} The invalid format message
   */
  toString() {
    return "Invalid format. Use /notify <price> or /notify <price> <pool_address>";
  }
}

/**
 * Represents an invalid price format message
 */
class InvalidPriceFormatMessage {
  /**
   * Get the formatted message content
   * @returns {string} The invalid price format message
   */
  toString() {
    return "Invalid price format. Use /notify <price> or /notify <price> <pool_address>";
  }
}

/**
 * Represents a price alert set for all pools message
 */
class PriceAlertSetAllPoolsMessage {
  /**
   * Create a price alert set for all pools message instance
   * @param {number} targetPrice - Target price for the alert
   * @param {number} notificationsSet - Number of notifications set
   */
  constructor(targetPrice, notificationsSet) {
    this.targetPrice = targetPrice;
    this.notificationsSet = notificationsSet;
  }

  /**
   * Get the formatted message content
   * @returns {string} The price alert set message
   */
  toString() {
    return `Price alert set at ${this.targetPrice} for ${this.notificationsSet} pool(s) in this chat.`;
  }
}

/**
 * Represents a notifications setup failure message
 */
class NotificationsSetupFailureMessage {
  /**
   * Get the formatted message content
   * @returns {string} The setup failure message
   */
  toString() {
    return "Could not set notifications. Make sure pools are properly initialized.";
  }
}

/**
 * Represents a pool not monitored message
 */
class PoolNotMonitoredMessage {
  /**
   * Create a pool not monitored message instance
   * @param {string} poolAddress - Pool address
   */
  constructor(poolAddress) {
    this.poolAddress = poolAddress;
  }

  /**
   * Get the formatted message content
   * @returns {string} The pool not monitored message
   */
  toString() {
    return `Pool ${this.poolAddress} is not monitored in this chat.`;
  }
}

/**
 * Represents a pool not initialized message
 */
class PoolNotInitializedMessage {
  /**
   * Create a pool not initialized message instance
   * @param {string} poolAddress - Pool address
   */
  constructor(poolAddress) {
    this.poolAddress = poolAddress;
  }

  /**
   * Get the formatted message content
   * @returns {string} The pool not initialized message
   */
  toString() {
    return `Pool ${this.poolAddress} is not initialized yet or price data is not available.`;
  }
}

/**
 * Represents a price alert set for specific pool message
 */
class PriceAlertSetSpecificPoolMessage {
  /**
   * Create a price alert set for specific pool message instance
   * @param {number} targetPrice - Target price for the alert
   * @param {string} token1Symbol - Token 1 symbol
   * @param {string} token0Symbol - Token 0 symbol
   */
  constructor(targetPrice, token1Symbol, token0Symbol) {
    this.targetPrice = targetPrice;
    this.token1Symbol = token1Symbol;
    this.token0Symbol = token0Symbol;
  }

  /**
   * Get the formatted message content
   * @returns {string} The price alert set message
   */
  toString() {
    return `Price alert set at ${this.targetPrice} for ${this.token1Symbol}/${this.token0Symbol} pool.`;
  }
}

class NotifyHandler {
  /**
   * Register command handlers with the bot
   * @param {TelegramBot} bot - The bot instance
   * @param {Object} monitoredPools - Object containing monitored pools
   */
  static onText(bot, monitoredPools) {
    bot.onText(/\/notify (.+)/, (msg, match) => {
      this.handle(bot, msg, match, monitoredPools);
    });
  }

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
      const noPoolsMessage = new NoPoolsMonitoredMessage();
      await bot.sendMessage(chatId, noPoolsMessage.toString());
      return;
    }

    // Handle both formats: "/notify <price>" and "/notify <price> <pool_address>"
    if (params.length === 1) {
      // Format: "/notify <price>" - applies to all pools in the chat
      await this.handleNotifyAllPools(bot, chatId, params[0], poolsInChat);
    } else if (params.length === 2) {
      // Format: "/notify <price> <pool_address>"
      const targetPrice = parseFloat(params[0]);
      const poolAddress = params[1];
      await this.handleNotifySpecificPool(bot, chatId, poolAddress, targetPrice, monitoredPools);
    } else {
      const invalidFormatMessage = new InvalidFormatMessage();
      await bot.sendMessage(chatId, invalidFormatMessage.toString());
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
• \`/pool <address>\` - Start monitoring a pool
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
      const invalidPriceMessage = new InvalidPriceFormatMessage();
      await bot.sendMessage(chatId, invalidPriceMessage.toString());
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
      const alertSetMessage = new PriceAlertSetAllPoolsMessage(targetPrice, notificationsSet);
      await bot.sendMessage(chatId, alertSetMessage.toString());
    } else {
      const setupFailureMessage = new NotificationsSetupFailureMessage();
      await bot.sendMessage(chatId, setupFailureMessage.toString());
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
      const invalidPriceMessage = new InvalidPriceFormatMessage();
      await bot.sendMessage(chatId, invalidPriceMessage.toString());
      return;
    }

    // Check if the specified pool is being monitored
    if (!monitoredPools[poolAddress] || monitoredPools[poolAddress].chatId !== chatId) {
      const poolNotMonitoredMessage = new PoolNotMonitoredMessage(poolAddress);
      await bot.sendMessage(chatId, poolNotMonitoredMessage.toString());
      return;
    }

    const poolInfo = monitoredPools[poolAddress];

    if (!poolInfo.lastPriceT1T0) {
      const poolNotInitializedMessage = new PoolNotInitializedMessage(poolAddress);
      await bot.sendMessage(chatId, poolNotInitializedMessage.toString());
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

    const alertSetMessage = new PriceAlertSetSpecificPoolMessage(
      targetPrice,
      poolInfo.token1.symbol,
      poolInfo.token0.symbol
    );
    await bot.sendMessage(chatId, alertSetMessage.toString());
  }
}

module.exports = NotifyHandler;

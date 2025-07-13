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
   * Create a new NotifyHandler instance
   * @param {TelegramBot} bot - The bot instance
   * @param {Object} monitoredPools - Object containing monitored pools
   */
  constructor(bot, monitoredPools) {
    this.bot = bot;
    this.monitoredPools = monitoredPools;

    // Register handlers on instantiation
    this.registerHandlers();
  }

  /**
   * Register command handlers with the bot
   */
  registerHandlers() {
    this.bot.onText(/\/notify (.+)/, (msg, match) => {
      this.handle(msg, match);
    });
  }

  /**
   * Handle notify command to set price alerts
   * @param {Object} msg - Message object from Telegram
   * @param {Array} match - Regex match array containing the command params
   */
  async handle(msg, match) {
    const chatId = msg.chat.id;
    const params = match[1].trim().split(/\s+/);

    // Check if we have any pools monitored in this chat
    const poolsInChat = Object.entries(this.monitoredPools).filter(
      ([_, poolData]) => poolData.chatId === chatId
    );

    if (poolsInChat.length === 0) {
      const noPoolsMessage = new NoPoolsMonitoredMessage();
      await this.bot.sendMessage(chatId, noPoolsMessage.toString());
      return;
    }

    // Handle both formats: "/notify <price>" and "/notify <price> <pool_address>"
    if (params.length === 1) {
      // Format: "/notify <price>" - applies to all pools in the chat
      await this.handleNotifyAllPools(chatId, params[0], poolsInChat);
    } else if (params.length === 2) {
      // Format: "/notify <price> <pool_address>"
      const targetPrice = parseFloat(params[0]);
      const poolAddress = params[1];
      await this.handleNotifySpecificPool(chatId, poolAddress, targetPrice);
    } else {
      const invalidFormatMessage = new InvalidFormatMessage();
      await this.bot.sendMessage(chatId, invalidFormatMessage.toString());
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
   * @param {number} chatId - Chat ID
   * @param {string} priceParam - Price parameter from command
   * @param {Array} poolsInChat - Array of pools in the chat
   */
  async handleNotifyAllPools(chatId, priceParam, poolsInChat) {
    const targetPrice = parseFloat(priceParam);

    if (isNaN(targetPrice)) {
      const invalidPriceMessage = new InvalidPriceFormatMessage();
      await this.bot.sendMessage(chatId, invalidPriceMessage.toString());
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
      await this.bot.sendMessage(chatId, alertSetMessage.toString());
    } else {
      const setupFailureMessage = new NotificationsSetupFailureMessage();
      await this.bot.sendMessage(chatId, setupFailureMessage.toString());
    }
  }

  /**
   * Handle setting notification for a specific pool
   * @param {number} chatId - Chat ID
   * @param {string} poolAddress - Pool address
   * @param {number} targetPrice - Target price for notification
   */
  async handleNotifySpecificPool(chatId, poolAddress, targetPrice) {
    if (isNaN(targetPrice)) {
      const invalidPriceMessage = new InvalidPriceFormatMessage();
      await this.bot.sendMessage(chatId, invalidPriceMessage.toString());
      return;
    }

    // Check if the specified pool is being monitored
    if (!this.monitoredPools[poolAddress] || this.monitoredPools[poolAddress].chatId !== chatId) {
      const poolNotMonitoredMessage = new PoolNotMonitoredMessage(poolAddress);
      await this.bot.sendMessage(chatId, poolNotMonitoredMessage.toString());
      return;
    }

    const poolInfo = this.monitoredPools[poolAddress];

    if (!poolInfo.lastPriceT1T0) {
      const poolNotInitializedMessage = new PoolNotInitializedMessage(poolAddress);
      await this.bot.sendMessage(chatId, poolNotInitializedMessage.toString());
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
    await this.bot.sendMessage(chatId, alertSetMessage.toString());
  }
}

module.exports = NotifyHandler;

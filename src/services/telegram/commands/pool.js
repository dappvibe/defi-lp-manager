/**
 * Handler for /pool command
 * Lists all configured pools with toggle buttons for monitoring
 * Usage: /pool
 */
const { createPoolContract } = require('../../uniswap/contracts');
const poolService = require('../../uniswap/pool');
const { calculatePrice } = require('../../uniswap/utils');
const poolsConfig = require('../../../config/pools');

/**
 * Represents a no pools configured message
 */
class NoPoolsMessage {
  /**
   * Get the formatted message content
   * @returns {string} The no pools message
   */
  toString() {
    return "No pools are configured.";
  }
}

/**
 * Represents a pool information message with current price, TVL and toggle button
 */
class PoolInfoMessage {
  /**
   * Create a pool info message instance
   * @param {Object} poolInfo - Pool information object
   * @param {string} poolAddress - Pool address
   * @param {string} currentPrice - Current price as string
   * @param {string} tvlText - TVL text (empty if not available)
   * @param {boolean} isMonitored - Whether pool is currently monitored
   * @param {Object} options - Additional options
   * @param {boolean} [options.includeTimestamp] - Whether to include timestamp
   */
  constructor(poolInfo, poolAddress, currentPrice, tvlText, isMonitored, options = {}) {
    this.poolInfo = poolInfo;
    this.poolAddress = poolAddress;
    this.currentPrice = currentPrice;
    this.tvlText = tvlText;
    this.isMonitored = isMonitored;
    this.options = options;
  }

  /**
   * Get the formatted message content
   * @returns {string} The complete formatted message
   */
  toString() {
    const pair = `[${this.poolInfo.token0.symbol}/${this.poolInfo.token1.symbol}](https://pancakeswap.finance/info/v3/arb/pairs/${this.poolAddress})`;
    const feePercent = this.poolInfo.fee ? (this.poolInfo.fee / 10000).toFixed(2) + '%' : 'Unknown';
    const pairWithFee = `${pair} (${feePercent})`;

    let messageText = `📊 ${this.currentPrice}
💰 **${pairWithFee}**`;

    // Add TVL if available
    if (this.tvlText) {
      messageText += `\n${this.tvlText}`;
    }

    // Add timestamp if requested
    if (this.options.includeTimestamp) {
      const { getTimeInTimezone } = require('../../../utils/time');
      const updateTime = getTimeInTimezone();
      messageText += `
⏰ ${updateTime}`;
    }

    return messageText;
  }

  /**
   * Get the inline keyboard for the message
   * @returns {Object} Inline keyboard object
   */
  getKeyboard() {
    return {
      inline_keyboard: [[
        {
          text: this.isMonitored ? '🔴 Stop Monitoring' : '🟢 Start Monitoring',
          callback_data: `pool_${this.isMonitored ? 'stop' : 'start'}_${this.poolAddress}`
        }
      ]]
    };
  }
}

/**
 * Represents an error message for pool operations
 */
class PoolErrorMessage {
  /**
   * Create a pool error message instance
   * @param {string} errorText - Error message text
   */
  constructor(errorText) {
    this.errorText = errorText;
  }

  /**
   * Get the formatted message content
   * @returns {string} The error message
   */
  toString() {
    return this.errorText;
  }
}

class PoolHandler {
  /**
   * Create a new PoolHandler instance
   * @param {TelegramBot} bot - The bot instance
   * @param {Object} monitoredPools - Object containing monitored pools
   */
  constructor(bot, monitoredPools) {
    this.bot = bot;
    this.monitoredPools = monitoredPools;

    /**
     * Store active pool monitors for cleanup
     * @type {Map<string, {chatId: number, messageId: number}>} Map of poolAddress -> message info
     */
    this.activeMonitors = new Map();

    /**
     * Store event listener reference for cleanup
     * @type {Function|null}
     */
    this.swapEventListener = null;

    // Register handlers on instantiation
    this.registerHandlers();
  }

  /**
   * Register command handlers with the bot
   */
  registerHandlers() {
    // Wrap to keep 'this' context of PoolHandler
    this.bot.onText(/\/pool/, (msg) => {
      this.handleText(msg);
    });

    // Callback query handlers for pool toggle buttons
    this.bot.on('callback_query', (callbackQuery) => {
      this.handleCallback(callbackQuery);
    });

    // Initialize event listener for swap events
    this.initializeSwapEventListener();
  }

  /**
   * Handle pool command to list all configured pools
   * @param {Object} msg - Message object from Telegram
   */
  async handleText(msg) {
    const chatId = msg.chat.id;

    try {
      // Get all configured pools
      const configuredPools = poolsConfig.getEnabledPools();

      if (configuredPools.length === 0) {
        const noPoolsMessage = new NoPoolsMessage();
        await this.bot.sendMessage(chatId, noPoolsMessage.toString());
        return;
      }

      // Send a message for each configured pool
      for (const poolConfig of configuredPools) {
        await this.sendOrUpdatePoolMessage(chatId, null, poolConfig.address);
      }

    } catch (error) {
      console.error('Error listing pools:', error);
      const errorMessage = new PoolErrorMessage('Error loading pools. Please try again.');
      await this.bot.sendMessage(chatId, errorMessage.toString());
    }
  }

  /**
   * Handle callback queries from pool toggle buttons
   * @param {Object} callbackQuery - Callback query object
   */
  async handleCallback(callbackQuery) {
    const chatId = callbackQuery.message.chat.id;
    const messageId = callbackQuery.message.message_id;
    const data = callbackQuery.data;

    // Parse callback data: pool_action_address
    if (!data.startsWith('pool_')) {
      return; // Not our callback
    }

    const parts = data.split('_');
    if (parts.length !== 3) {
      await this.bot.answerCallbackQuery(callbackQuery.id, { text: 'Invalid callback data' });
      return;
    }

    const action = parts[1]; // start, stop
    const poolAddress = parts[2];

    try {
      switch (action) {
        case 'start':
          await this.startPoolMonitoring(chatId, messageId, poolAddress);
          await this.bot.answerCallbackQuery(callbackQuery.id, { text: 'Monitoring started!' });
          break;
        case 'stop':
          await this.stopPoolMonitoring(poolAddress, chatId, messageId);
          await this.sendOrUpdatePoolMessage(chatId, messageId, poolAddress);
          await this.bot.answerCallbackQuery(callbackQuery.id, { text: 'Monitoring stopped!' });
          break;
        default:
          await this.bot.answerCallbackQuery(callbackQuery.id, { text: 'Unknown action' });
      }
    } catch (error) {
      console.error(`Error handling callback for pool ${poolAddress}:`, error.message);
      await this.bot.answerCallbackQuery(callbackQuery.id, { text: 'Error processing request' });
    }
  }

  /**
   * Start monitoring a pool from callback
   * @param {number} chatId - Chat ID
   * @param {number} messageId - Message ID to update
   * @param {string} poolAddress - Pool address
   */
  async startPoolMonitoring(chatId, messageId, poolAddress) {
    try {
      const result = await poolService.startPoolMonitoring(this.bot, poolAddress, chatId, messageId);

      // Store monitor info for event handling
      this.activeMonitors.set(poolAddress, {
        chatId: chatId,
        messageId: messageId
      });

      // Immediately update the pool message with current price and timestamp
      await this.sendOrUpdatePoolMessage(chatId, messageId, poolAddress, {
        preCalculatedPrice: result.currentPrice,
        includeTimestamp: true
      });

      console.log(`Started monitoring pool ${poolAddress} in chat ${chatId}`);
    } catch (error) {
      console.error(`Error starting pool monitoring for ${poolAddress}:`, error.message);
      throw error;
    }
  }

  /**
   * Stop monitoring a pool
   * @param {string} poolAddress - Pool address
   * @param {number} chatId - Chat ID
   * @param {number} messageId - Message ID
   */
  async stopPoolMonitoring(poolAddress, chatId, messageId) {
    try {
      await poolService.stopMonitoring(poolAddress);

      // Remove from active monitors
      this.activeMonitors.delete(poolAddress);

      console.log(`Stopped monitoring pool ${poolAddress} in chat ${chatId}`);
    } catch (error) {
      console.error(`Error stopping pool monitoring for ${poolAddress}:`, error.message);
      throw error;
    }
  }

  /**
   * Initialize event listener for swap events from PoolService
   */
  initializeSwapEventListener() {
    if (this.swapEventListener) {
      poolService.removeListener('swap', this.swapEventListener);
    }

    this.swapEventListener = (swapInfo, poolData) => {
      this.handleSwapEvent(swapInfo, poolData);
    };

    poolService.on('swap', this.swapEventListener);
    console.log('Initialized swap event listener for pool command');
  }

  /**
   * Handle swap event from PoolService
   * @param {Object} swapInfo - Swap information
   * @param {Object} poolData - Pool data
   */
  async handleSwapEvent(swapInfo, poolData) {
    const { poolAddress, newPrice, timestamp } = swapInfo;
    const monitorInfo = this.activeMonitors.get(poolAddress);

    if (!monitorInfo) {
      return; // No active monitor for this pool
    }

    try {
      // Update the pool message with new price and timestamp
      await this.sendOrUpdatePoolMessage(monitorInfo.chatId, monitorInfo.messageId, poolAddress, {
        preCalculatedPrice: newPrice,
        includeTimestamp: true
      });

      console.log(`Updated pool message for ${poolAddress} in chat ${monitorInfo.chatId} via swap event - new price: ${newPrice}`);
    } catch (error) {
      console.error(`Error handling swap event for pool ${poolAddress}:`, error.message);
    }
  }

  /**
   * Send or update a pool message with current price, TVL and toggle button
   * @param {number} chatId - Chat ID
   * @param {number|null} messageId - Message ID to update (null for new message)
   * @param {string} poolAddress - Pool address
   * @param {Object} options - Additional options
   * @param {number} [options.preCalculatedPrice] - Pre-calculated price to use instead of fetching
   * @param {boolean} [options.includeTimestamp] - Whether to include timestamp in message
   */
  async sendOrUpdatePoolMessage(chatId, messageId, poolAddress, options = {}) {
    try {
      // Find pool config
      const poolConfig = poolsConfig.getPoolByAddress(poolAddress);
      if (!poolConfig) {
        console.error(`Pool config not found for ${poolAddress}`);
        return;
      }

      // Get pool information from cache/database
      const poolInfo = await poolService.getPool(poolAddress);

      if (!poolInfo || !poolInfo.token0 || !poolInfo.token1) {
        console.error(`Pool info not available for ${poolAddress}`);
        return;
      }

      // Get current price (use pre-calculated if provided)
      let currentPrice = 'N/A';
      if (options.preCalculatedPrice !== undefined) {
        currentPrice = options.preCalculatedPrice.toFixed(5);
      } else {
        try {
          const price = await poolService.getPoolPrice(poolAddress);
          currentPrice = price !== null ? price.toFixed(5) : 'N/A';
        } catch (error) {
          console.error(`Error getting price for pool ${poolAddress}:`, error.message);
        }
      }

      // Calculate TVL
      let tvlText = '';
      try {
        const tvl = await poolService.getPoolTVL(poolInfo, poolAddress);
        if (tvl !== null && tvl > 0) {
          tvlText = `💎 TVL: $${tvl.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
        }
      } catch (error) {
        console.error(`Error calculating TVL for pool ${poolAddress}:`, error.message);
      }

      // Check if pool is currently being monitored
      const isMonitored = poolService.isMonitoring(poolAddress);

      // Create pool info message
      const poolInfoMessage = new PoolInfoMessage(
        poolInfo,
        poolAddress,
        currentPrice,
        tvlText,
        isMonitored,
        {
          includeTimestamp: options.includeTimestamp
        }
      );

      const messageOptions = {
        parse_mode: 'Markdown',
        reply_markup: poolInfoMessage.getKeyboard(),
        disable_web_page_preview: true
      };

      let resultMessage;
      // Update message if messageId is provided, otherwise send new message
      if (messageId) {
        resultMessage = await this.bot.editMessageText(poolInfoMessage.toString(), {
          chat_id: chatId,
          message_id: messageId,
          ...messageOptions
        });
      } else {
        resultMessage = await this.bot.sendMessage(chatId, poolInfoMessage.toString(), messageOptions);

        // Update message ID in MongoDB for this pool
        if (resultMessage && resultMessage.message_id) {
          await this.updatePoolMessageId(poolAddress, chatId, resultMessage.message_id);
        }
      }

    } catch (error) {
      console.error(`Error ${messageId ? 'updating' : 'sending'} pool message for ${poolAddress}:`, error.message);
    }
  }

  /**
   * Update the message ID for a pool in MongoDB
   * @param {string} poolAddress - Pool address
   * @param {number} chatId - Chat ID
   * @param {number} messageId - New message ID
   */
  async updatePoolMessageId(poolAddress, chatId, messageId) {
    try {
      // Get existing pool data
      const existingPoolData = await poolService.stateManager.getCachedPoolInfo(poolAddress);

      if (existingPoolData) {
        // Update the pool data with new message ID and chat ID
        const updatedPoolData = {
          ...existingPoolData,
          chatId: chatId,
          messageId: messageId
        };

        // Save the updated pool data
        await poolService.stateManager.savePoolState(poolAddress, updatedPoolData);
        console.log(`Updated message ID for pool ${poolAddress}: chatId=${chatId}, messageId=${messageId}`);
      } else {
        console.warn(`No existing pool data found for ${poolAddress} when trying to update message ID`);
      }
    } catch (error) {
      console.error(`Error updating message ID for pool ${poolAddress}:`, error.message);
    }
  }

  /**
   * Clean up event listeners and active monitors
   */
  cleanup() {
    if (this.swapEventListener) {
      poolService.removeListener('swap', this.swapEventListener);
      this.swapEventListener = null;
    }
    this.activeMonitors.clear();
    console.log('Cleaned up pool handler resources');
  }

  /**
   * Returns a brief help description with command signature
   * @returns {string} One-line help text
   */
  static help() {
    return "/pool - List all configured pools with toggle buttons for monitoring";
  }

  /**
   * Returns usage information for the pool command
   * @returns {string} Help text for humans
   */
  static usage() {
    return `🏊 **Pool Command Help**

**Usage:**
\`/pool\` - List all configured pools with current prices and toggle buttons

**Description:**
Shows all pre-configured pools as individual messages, each displaying:
• Current price
• Token pair information
• Total Value Locked (TVL)
• Platform and blockchain
• Toggle button to start/stop monitoring

**Button Actions:**
🟢 **Start Monitoring** - Begin price monitoring for the pool
🔴 **Stop Monitoring** - Stop price monitoring for the pool

**Notes:**
• Pool monitoring includes real-time price updates
• Price alerts can be set for monitored pools
• Current prices and TVL are displayed for all pools
• Use toggle buttons to control monitoring state

**Related Commands:**
• \`/notify <price> [pool]\` - Set price alerts for monitored pools
• \`/wallet\` - Monitor wallet positions instead`;
  }
}

module.exports = PoolHandler;

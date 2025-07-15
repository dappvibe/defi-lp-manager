/**
 * Handler for /pool command
 * Lists all configured pools with toggle buttons for monitoring
 * Usage: /pool
 */
const { Pool } = require('../../uniswap/pool');

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
   * @param pool
   * @param price
   */
  constructor(pool, price) {
    this.pool = pool;
    this.price = price;
  }

  /**
   * Get the formatted message content
   * @returns {string} The complete formatted message
   */
  toString() {
    const pair = `[${this.pool.info.token0.symbol}/${this.pool.info.token1.symbol}](https://pancakeswap.finance/info/v3/arb/pairs/${this.pool.address})`;
    const feePercent = this.pool.info.fee ? (this.pool.info.fee / 10000).toFixed(2) + '%' : 'Unknown';
    const pairWithFee = `${pair} (${feePercent})`;

    let messageText = `📊 ${this.price.toFixed(4)}
💰 **${pairWithFee}**`;

    // Add TVL if available
    if (this.pool.tvl) {
      const tvlText = `💎 TVL: $${this.pool.info.tvl.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
      messageText += `\n${tvlText}`;
    }

    const { getTimeInTimezone } = require('../../../utils/time');
    const updateTime = getTimeInTimezone();
    messageText += `
⏰ ${updateTime}`;

    return messageText;
  }

  getOptions() {
    return {
      parse_mode: 'Markdown',
      reply_markup: this.getKeyboard(),
      disable_web_page_preview: true
    };
  }

  /**
   * Get the inline keyboard for the message
   * @returns {Object} Inline keyboard object
   */
  getKeyboard() {
    const isMonitored = this.pool.getMonitoringStatus();
    return {
      inline_keyboard: [[
        {
          text: isMonitored ? '🔴 Stop Monitoring' : '🟢 Start Monitoring',
          callback_data: `pool_${isMonitored ? 'stop' : 'start'}_${this.pool.address}`
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
   * @param db
   * @param poolsConfig
   */
  constructor(bot, db, poolsConfig) {
    this.bot = bot;
    this.db = db;

    // just load deps, no requests are made here
    this.pools = new Map();
    const configuredPools = poolsConfig.getPools('pancakeswap', 'arbitrum');
    for (const address of configuredPools) {
      this.pools[address] = new Pool(address);
    }

    /**
     * Store event listener reference for cleanup
     * @type {Function}
     */
    this.swapEventListener = (swapInfo, poolData) => {
      this.handleSwapEvent(swapInfo, poolData);
    };;

    // Register handlers on instantiation
    this.registerHandlers();

    // Restore monitored pools on startup
    this.restoreMonitoredPools();
  }

  /**
   * Restore monitoring for pools that were previously monitored
   * Called automatically during constructor
   */
  async restoreMonitoredPools() {
    try {
      console.log('Restoring monitored pools from database...');

      // Get all monitored pool messages
      const monitoredPoolMessages = await this.db.getMonitoredPoolMessages();

      console.log(`Found ${monitoredPoolMessages.length} pool messages to restore monitoring for`);

      // Restore monitoring for each pool
      for (const poolMessage of monitoredPoolMessages) {
        try {
          const pool = this.pools[poolMessage.poolAddress];
          if (pool) {
            // Set the chat and message IDs from database
            if (poolMessage.chatId && poolMessage.messageId) {
              await pool.getPoolInfo();
              pool.info.chatId = poolMessage.chatId;
              pool.info.messageId = poolMessage.messageId;
            }

            // Start monitoring
            await this.startPoolMonitoring(pool.address);
            console.log(`Restored monitoring for pool ${pool.address}`);
          } else {
            console.warn(`Pool ${poolMessage.poolAddress} not found in configuration, skipping restore`);
          }
        } catch (error) {
          console.error(`Error restoring monitoring for pool ${poolMessage.poolAddress}:`, error.message);
        }
      }

      console.log('Pool monitoring restoration completed');
    } catch (error) {
      console.error('Error restoring monitored pools:', error);
    }
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
  }

  /**
   * Handle pool command to list all configured pools
   * @param {Object} msg - Message object from Telegram
   */
  async handleText(msg) {
    const chatId = msg.chat.id;

    try {
      if (Object.keys(this.pools).length === 0) {
        const noPoolsMessage = new NoPoolsMessage();
        await this.bot.sendMessage(chatId, noPoolsMessage.toString());
        return;
      }

      // Send a message for each configured pool
      for (const pool of Object.values(this.pools)) {
        await pool.getPoolInfo(); // fetch from db or blockchain
        const price = await pool.getCurrentPrice(); // fetch fresh on list

        // On /pool command always send new list
          pool.info.messageId = null;

        // defer request (order is not important)
        this.sendOrUpdatePoolMessage(chatId, pool, price);
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
      const pool = this.pools[poolAddress];
      if (!pool) {
        await this.bot.answerCallbackQuery(callbackQuery.id, { text: 'Pool not found' });
        return;
      }

      switch (action) {
        case 'start':
          // Set the message ID before starting monitoring so it updates the existing message
          if (!pool.info) {
            await pool.getPoolInfo();
          }
          pool.info.messageId = messageId;
          pool.info.chatId = chatId;

          await this.startPoolMonitoring(poolAddress);

          // Save pool message to database
          await this.db.savePoolMessage(poolAddress, chatId, messageId, true);

          await this.bot.answerCallbackQuery(callbackQuery.id, { text: 'Monitoring started!' });
          break;
        case 'stop':
          await this.stopPoolMonitoring(poolAddress, chatId, messageId);

          // Remove pool message from database
          await this.db.removePoolMessage(poolAddress, chatId);

          await this.sendOrUpdatePoolMessage(chatId, pool, await pool.getCurrentPrice());
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
   * @param address
   */
  async startPoolMonitoring(address) {
    const pool = this.pools[address];
    if (!pool) {
      throw new Error(`Pool ${address} not configured.`);
    }

    try {
      // start listening blockchain for swaps
      const { info, price } = await pool.startMonitoring();

      // Immediately update the pool message with current price and timestamp
      await this.sendOrUpdatePoolMessage(pool.info.chatId, pool, price);

      this.initializeSwapEventListener(pool);

      console.log(`Started monitoring pool ${address} in chat ${pool.info.chatId}`);
    } catch (error) {
      console.error(`Error starting pool monitoring for ${address}:`, error.message);
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
    const pool = this.pools[poolAddress];

    try {
      await pool.stopMonitoring();

      pool.removeListener('swap', this.swapEventListener);

      console.log(`Stopped monitoring pool ${poolAddress} in chat ${chatId}`);
    } catch (error) {
      console.error(`Error stopping pool monitoring for ${poolAddress}:`, error.message);
      throw error;
    }
  }

  /**
   * Initialize event listener for swap events from PoolService
   */
  initializeSwapEventListener(pool) {
    pool.removeListener('swap', this.swapEventListener);
    pool.on('swap', this.swapEventListener);
    console.log('Initialized swap event listener for pool command');
  }

  /**
   * Handle swap event from PoolService
   * @param {Object} swapInfo - Swap information
   * @param {Object} poolData - Pool data
   */
  async handleSwapEvent(swapInfo, poolData) {
    const { address, newPrice, timestamp } = swapInfo;

    // get chat and message ids from pool messages collection
    const pool = this.pools[poolData.address];
    await pool.getPoolInfo();

    // Find all pool messages for this pool
    const monitoredPoolMessages = await this.db.getMonitoredPoolMessages();
    const poolMessages = monitoredPoolMessages.filter(msg => msg.poolAddress === address);

    try {
      // Update all pool messages for this pool
      for (const poolMessage of poolMessages) {
        pool.info.chatId = poolMessage.chatId;
        pool.info.messageId = poolMessage.messageId;
        await this.sendOrUpdatePoolMessage(poolMessage.chatId, pool, newPrice);
      }
    } catch (error) {
      console.error(`Error handling swap event for pool ${address}:`, error.message);
    }
  }

  /**
   * Send or update a pool message with current price, TVL and toggle button
   * @param {number} chatId - Chat ID
   * @param pool
   * @param price From swap event or slot0
   */
  async sendOrUpdatePoolMessage(chatId, pool, price) {
    try {
      if (!pool.info || !pool.info.token0 || !pool.info.token1) {
        console.error(`Pool info not available for ${pool.address}`);
        return;
      }

      const msg = new PoolInfoMessage(pool, price);

      const messageOptions = msg.getOptions();

      let result;
      // Update message if pool.info.messageId is provided, otherwise send new message
      if (pool.info.messageId) {
        result = await this.bot.editMessageText(msg.toString(), {
          chat_id: chatId,
          message_id: pool.info.messageId,
          ...messageOptions
        });
      } else {
        result = await this.bot.sendMessage(chatId, msg.toString(), messageOptions);

        // Update message ID in pool messages collection
        if (result && result.message_id) {
          await this.updatePoolMessageId(pool.address, chatId, result.message_id);
        }
      }
    } catch (error) {
      console.error(`Error ${pool.info.messageId ? 'updating' : 'sending'} pool message for ${pool.address}:`, error.message);
    }
  }

  /**
   * Update the message ID for a pool message
   * @param {string} poolAddress - Pool address
   * @param {number} chatId - Chat ID
   * @param {number} messageId - New message ID
   */
  async updatePoolMessageId(poolAddress, chatId, messageId) {
    try {
      // Update the pool message with new message ID
      await this.db.updatePoolMessageId(poolAddress, chatId, messageId);

      // Also update the pool info for consistency
      const pool = this.pools[poolAddress];
      if (pool && pool.info) {
        pool.info.messageId = messageId;
        pool.info.chatId = chatId;
      }

      console.debug(`Updated message ID for pool message ${poolAddress}: chatId=${chatId}, messageId=${messageId}`);
    } catch (error) {
      console.error(`Error updating message ID for pool message ${poolAddress}:`, error.message);
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

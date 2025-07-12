/**
 * Handler for /pool command
 * Lists all configured pools with toggle buttons for monitoring
 * Usage: /pool
 */
const { getTokenInfo, createPoolContract } = require('../../uniswap/contracts');
const poolService = require('../../uniswap/pool');
const { calculatePrice } = require('../../uniswap/utils');
const { isValidEthereumAddress } = require('../../uniswap/utils');
const poolsConfig = require('../../../config/pools');

class PoolHandler {
  /**
   * Register command handlers with the bot
   * @param {TelegramBot} bot - The bot instance
   * @param {Object} provider - Ethereum provider instance
   * @param {Object} monitoredPools - Object containing monitored pools
   * @param {String} timezone - User timezone
   */
  static onText(bot, provider, monitoredPools, timezone) {
    // Pool listing command
    bot.onText(/\/pool/, (msg) => {
      this.handle(bot, msg, provider, monitoredPools, timezone);
    });

    // Callback query handlers for pool toggle buttons
    bot.on('callback_query', (callbackQuery) => {
      this.handleCallback(bot, callbackQuery, provider, timezone);
    });
  }

  /**
   * Handle pool command to list all configured pools
   * @param {TelegramBot} bot - The bot instance
   * @param {Object} msg - Message object from Telegram
   * @param {Object} provider - Ethereum provider instance
   * @param {Object} monitoredPools - Object containing monitored pools
   * @param {String} timezone - User timezone
   */
  static async handle(bot, msg, provider, monitoredPools, timezone) {
    const chatId = msg.chat.id;

    try {
      // Get all configured pools
      const configuredPools = poolsConfig.getEnabledPools();

      if (configuredPools.length === 0) {
        await bot.sendMessage(chatId, "No pools are configured.");
        return;
      }

      // Send a message for each configured pool
      for (const poolConfig of configuredPools) {
        await this.sendOrUpdatePoolMessage(bot, chatId, null, poolConfig.address, provider, timezone, 'send');
      }

    } catch (error) {
      console.error('Error listing pools:', error);
      await bot.sendMessage(chatId, 'Error loading pools. Please try again.');
    }
  }

  /**
   * Send or update a pool message with current price and toggle button
   * @param {TelegramBot} bot - The bot instance
   * @param {number} chatId - Chat ID
   * @param {number|null} messageId - Message ID to update (null for new message)
   * @param {string} poolAddress - Pool address
   * @param {Object} provider - Ethereum provider
   * @param {String} timezone - User timezone
   * @param {'send'|'edit'} action - Whether to send new message or edit existing
   * @param {Object} options - Additional options
   * @param {number} [options.preCalculatedPrice] - Pre-calculated price to use instead of fetching
   * @param {boolean} [options.includeTimestamp] - Whether to include timestamp in message
   */
  static async sendOrUpdatePoolMessage(bot, chatId, messageId, poolAddress, provider, timezone, action = 'send', options = {}) {
    try {
      // Find pool config
      const poolConfig = poolsConfig.getPoolByAddress(poolAddress);
      if (!poolConfig) {
        console.error(`Pool config not found for ${poolAddress}`);
        return;
      }

      // Get pool information from cache/database
      const poolInfo = await poolService.getPool(poolAddress, provider);

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
          const poolContract = createPoolContract(poolAddress);
          const slot0 = await poolContract.read.slot0();
          const sqrtPriceX96 = slot0[0];
          const price = parseFloat(calculatePrice(sqrtPriceX96, poolInfo.token0.decimals, poolInfo.token1.decimals));
          currentPrice = price.toFixed(5);
        } catch (error) {
          console.error(`Error getting price for pool ${poolAddress}:`, error.message);
        }
      }

      // Check if pool is currently being monitored
      const isMonitored = poolService.isMonitoring(poolAddress);

      // Create message text
      const pair = `[${poolInfo.token0.symbol}/${poolInfo.token1.symbol}](https://pancakeswap.finance/info/v3/arb/pairs/${poolAddress})`;
      const feePercent = poolInfo.fee ? (poolInfo.fee / 10000).toFixed(2) + '%' : 'Unknown';
      const pairWithFee = `${pair} (${feePercent})`;

      let messageText = `📊 ${currentPrice}
💰 **${pairWithFee}**`;

      // Add timestamp if requested
      if (options.includeTimestamp) {
        const { getTimeInTimezone } = require('../../../utils/time');
        const updateTime = getTimeInTimezone(timezone);
        messageText += `
⏰ ${updateTime}`;
      }

      // Create inline keyboard
      const keyboard = {
        inline_keyboard: [[
          {
            text: isMonitored ? '🔴 Stop Monitoring' : '🟢 Start Monitoring',
            callback_data: `pool_${isMonitored ? 'stop' : 'start'}_${poolAddress}`
          }
        ]]
      };

      const messageOptions = {
        parse_mode: 'Markdown',
        reply_markup: keyboard,
        disable_web_page_preview: true
      };

      let resultMessage;
      // Send or edit message based on action
      if (action === 'edit' && messageId) {
        resultMessage = await bot.editMessageText(messageText, {
          chat_id: chatId,
          message_id: messageId,
          ...messageOptions
        });
      } else {
        resultMessage = await bot.sendMessage(chatId, messageText, messageOptions);

        // Update message ID in MongoDB for this pool
        if (resultMessage && resultMessage.message_id) {
          await this.updatePoolMessageId(poolAddress, chatId, resultMessage.message_id);
        }
      }

    } catch (error) {
      console.error(`Error ${action === 'edit' ? 'updating' : 'sending'} pool message for ${poolAddress}:`, error.message);
    }
  }

  /**
   * Update the message ID for a pool in MongoDB
   * @param {string} poolAddress - Pool address
   * @param {number} chatId - Chat ID
   * @param {number} messageId - New message ID
   */
  static async updatePoolMessageId(poolAddress, chatId, messageId) {
    try {
      // Get the pool service instance to access the state manager
      const poolService = require('../../uniswap/pool');

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
   * Handle callback queries from pool toggle buttons
   * @param {TelegramBot} bot - The bot instance
   * @param {Object} callbackQuery - Callback query object
   * @param {Object} provider - Ethereum provider
   * @param {String} timezone - User timezone
   */
  static async handleCallback(bot, callbackQuery, provider, timezone) {
    const chatId = callbackQuery.message.chat.id;
    const messageId = callbackQuery.message.message_id;
    const data = callbackQuery.data;

    // Parse callback data: pool_action_address
    if (!data.startsWith('pool_')) {
      return; // Not our callback
    }

    const parts = data.split('_');
    if (parts.length !== 3) {
      await bot.answerCallbackQuery(callbackQuery.id, { text: 'Invalid callback data' });
      return;
    }

    const action = parts[1]; // start, stop
    const poolAddress = parts[2];

    try {
      switch (action) {
        case 'start':
          await this.startPoolMonitoring(bot, chatId, messageId, poolAddress, provider, timezone);
          await bot.answerCallbackQuery(callbackQuery.id, { text: 'Monitoring started!' });
          break;
        case 'stop':
          await poolService.stopMonitoring(poolAddress);
          await this.sendOrUpdatePoolMessage(bot, chatId, messageId, poolAddress, provider, timezone, 'edit');
          await bot.answerCallbackQuery(callbackQuery.id, { text: 'Monitoring stopped!' });
          break;
        default:
          await bot.answerCallbackQuery(callbackQuery.id, { text: 'Unknown action' });
      }
    } catch (error) {
      console.error(`Error handling callback for pool ${poolAddress}:`, error.message);
      await bot.answerCallbackQuery(callbackQuery.id, { text: 'Error processing request' });
    }
  }

  /**
   * Start monitoring a pool from callback
   * @param {TelegramBot} bot - The bot instance
   * @param {number} chatId - Chat ID
   * @param {number} messageId - Message ID to update
   * @param {string} poolAddress - Pool address
   * @param {Object} provider - Ethereum provider
   * @param {String} timezone - User timezone
   */
  static async startPoolMonitoring(bot, chatId, messageId, poolAddress, provider, timezone) {
    try {
      // Get pool information
      const poolInfo = await poolService.getPool(poolAddress, provider);

      if (!poolInfo || !poolInfo.token0 || !poolInfo.token1) {
        throw new Error('Pool information not available');
      }

      // Get current price
      const poolContract = createPoolContract(poolAddress);
      const slot0 = await poolContract.read.slot0();
      const sqrtPriceX96 = slot0[0];
      const priceT1T0 = parseFloat(calculatePrice(sqrtPriceX96, poolInfo.token0.decimals, poolInfo.token1.decimals));

      // Prepare pool data
      const poolData = {
        chatId,
        messageId,
        token0: poolInfo.token0,
        token1: poolInfo.token1,
        lastPriceT1T0: priceT1T0,
        notifications: [],
        fee: poolInfo.fee
      };

      // Start monitoring the pool
      await poolService.startMonitoring(bot, poolAddress, poolData, provider, timezone);

      // Immediately update the pool message with current price and timestamp
      await this.sendOrUpdatePoolMessage(bot, chatId, messageId, poolAddress, provider, timezone, 'edit', {
        preCalculatedPrice: priceT1T0,
        includeTimestamp: true
      });

      console.log(`Started monitoring pool ${poolAddress} in chat ${chatId} with immediate price update`);
    } catch (error) {
      console.error(`Error starting pool monitoring for ${poolAddress}:`, error.message);
      throw error;
    }
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
• Platform and blockchain
• Toggle button to start/stop monitoring

**Button Actions:**
🟢 **Start Monitoring** - Begin price monitoring for the pool
🔴 **Stop Monitoring** - Stop price monitoring for the pool

**Notes:**
• Pool monitoring includes real-time price updates
• Price alerts can be set for monitored pools
• Current prices are displayed for all pools
• Use toggle buttons to control monitoring state

**Related Commands:**
• \`/notify <price> [pool]\` - Set price alerts for monitored pools
• \`/wallet\` - Monitor wallet positions instead`;
  }
}

module.exports = PoolHandler;

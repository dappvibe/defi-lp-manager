/**
 * Handler for /pool command
 * Lists all configured pools with toggle buttons for monitoring
 * Usage: /pool
 */
const { Pool } = require('../../uniswap/pool');
const TelegramMessage = require("../message");
const { getTimeInTimezone, moneyFormat} = require('../../../utils');

/**
 * Represents a no pools configured message
 */
class NoPoolsMessage extends TelegramMessage {
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
class PoolInfoMessage extends TelegramMessage {
  /**
   * Create a pool info message instance
   * @param pool
   * @param price
   */
  constructor(pool, price) {
    super();
    this.pool = pool;
    this.price = price || 0;
    this.lastUpdate = null;
    this.editDelay = 5000;
  }

  /**
   * Get the formatted message content
   * @returns {string} The complete formatted message
   */
  toString() {
    const pair = `[${this.pool.info.token0.symbol}/${this.pool.info.token1.symbol}](https://pancakeswap.finance/info/v3/arb/pairs/${this.pool.address})`;
    const feePercent = this.pool.info.fee ? (this.pool.info.fee).toFixed(2) + '%' : 'Unknown';

    const updateTime = getTimeInTimezone();

    let messageText = `📊 ${moneyFormat(this.price)}`;

    // Add TVL if available
    if (this.pool.info.tvl) {
      messageText += `\n💎 $${moneyFormat(this.pool.info.tvl)}`;
    }

    messageText += `\n⏰ ${updateTime}`;
    messageText += `\n💰 ${pair} (${feePercent})`;

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
          text: isMonitored ? '🔴 Stop' : '🟢 Start Monitoring',
          callback_data: `pool_${isMonitored ? 'stop' : 'start'}_${this.pool.address}`
        }
      ]]
    };
  }
}

/**
 * Represents an error message for pool operations
 */
class PoolErrorMessage extends TelegramMessage {
  /**
   * Create a pool error message instance
   * @param {string} errorText - Error message text
   */
  constructor(errorText) {
    super();
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
    this.swapEventListener = (swapInfo, poolData) => {
      return this.onSwap(swapInfo, poolData);
    };
    this.registerHandlers();

    // store messages to update. each message has its pool as property
    this.messages = new Map();
    const configuredPools = poolsConfig.getPools('pancakeswap', 'arbitrum');
    this.db.getMonitoredPoolMessages().then(monitoredPools => {
      for (const address of configuredPools) {
        const msg = new PoolInfoMessage(Pool.getPool(address), null);
        this.messages.set(address, msg);
        const storedMessage = monitoredPools.find(p => p.poolAddress === address);
        if (storedMessage) {
          msg.chatId = storedMessage.chatId;
          msg.id = storedMessage.messageId;
          if (storedMessage.isMonitored) {
            this.startPoolMonitoring(msg);
          }
        }
      }
    });
  }

  /**
   * Handle pool command to list all configured pools
   * @param {Object} msg - Message object from Telegram
   */
  async handleText(msg) {
    const chatId = msg.chat.id;

    try {
      if (this.messages.size === 0) {
        const noPoolsMessage = new NoPoolsMessage();
        noPoolsMessage.chatId = chatId;
        return this.bot.send(noPoolsMessage);
      }

      // Send a message for each configured pool
      for (const message of this.messages.values()) {
        await message.pool.getPoolInfo(); // fetch from db or blockchain
        const [price, tvl] = await Promise.all([
          message.pool.getCurrentPrice(),
          message.pool.getTVL()
        ]);
        message.price = price;
        message.pool.info.tvl = tvl;

        // On /pool command always send new list
        if (message.id) this.bot.deleteMessage(chatId, message.id).catch(console.debug);
        message.chatId = chatId;
        message.id = null;

        await this.bot.send(message).then(msg => {
          this.messages.set(message.pool.address, msg);
          this.db.create(message.pool.address, chatId, msg.id, msg.pool.getMonitoringStatus());
        });
      }
    } catch (error) {
      console.error('Error listing pools:', error);
      const errorMessage = new PoolErrorMessage('Error loading pools. Please try again.');
      errorMessage.chatId = chatId;
      await this.bot.send(errorMessage);
    }
  }

  /**
   * Handle callback queries from pool toggle buttons
   * @param {Object} callbackQuery - Callback query object
   */
  async handleCallback(callbackQuery) {
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
      const message = this.messages.get(poolAddress);
      if (!message) { // noinspection ExceptionCaughtLocallyJS
        throw new Error('Pool message not found: ' + poolAddress);
      }

      switch (action) {
        case 'start':
          message.price = await this.startPoolMonitoring(message);
          await this.bot.send(message); // update callback button
          return this.bot.answerCallbackQuery(callbackQuery.id, { text: 'Monitoring started!' });
        case 'stop':
          await this.stopPoolMonitoring(message);
          await this.bot.send(message); // update callback button
          return this.bot.answerCallbackQuery(callbackQuery.id, { text: 'Monitoring stopped!' });
        default:
          await this.bot.answerCallbackQuery(callbackQuery.id, { text: 'Unknown action' });
      }
    } catch (error) {
      console.error(`Error handling callback for pool ${poolAddress}:`, error.message);
    }
  }

  /**
   * Start listening blockchain for swaps
   * @param message
   */
  async startPoolMonitoring(message) {
    try {
      const { info, price } = await message.pool.startMonitoring();
      this.listenSwaps(message.pool);
      this.db.create(message.pool.address, message.chatId, message.id, true);
      return price;
    } catch (error) {
      console.error(`Error starting pool monitoring  ${message.pool.info.token0.symbol}/${message.pool.info.token1.symbol} (${message.pool.info.fee}%)`, error.message);
    }
  }

  /**
   * Stop monitoring a pool
   * @param message
   */
  async stopPoolMonitoring(message) {
    try {
      message.pool.removeListener('swap', this.swapEventListener);
      await message.pool.stopMonitoring();
      this.db.create(message.pool.address, message.chatId, message.id, false);
    } catch (error) {
      console.error(`Error stopping pool monitoring ${message.pool.info.token0.symbol}/${message.pool.info.token1.symbol} (${message.pool.info.fee}%)`, error.message);
    }
  }

  /**
   * Initialize event listener for swap events from PoolService
   */
  listenSwaps(pool) {
    pool.removeListener('swap', this.swapEventListener);
    pool.on('swap', this.swapEventListener);
  }

  /**
   * Handle swap event from PoolService
   * @param {Object} swapInfo - Swap information
   * @param {Object} poolData - Pool data
   */
  async onSwap(swapInfo, poolData) {
    const { address, newPrice, timestamp } = swapInfo;

    const msg = this.messages.get(address);
    try {

      // price is updated often, we must not let API to rate limit requests
      if (msg.lastUpdate !== null) {
        const timeSinceLastEdit = Date.now() - msg.lastUpdate;
        const delayNeeded = Math.max(0, msg.editDelay - timeSinceLastEdit);
        if (delayNeeded) return;
      }

      // rounded price didn't change
      const oldText = msg.toString();
      msg.price = newPrice;
      if (oldText === msg.toString()) return;

      msg.pool.info.tvl = await msg.pool.getTVL();

      return await this.bot.send(msg).then(msg => {msg.lastUpdate = Date.now()});
    } catch (error) {
      console.error(`Error handling swap event for pool ${address}:`, error.message);
      msg.pool.removeListener('swap', this.swapEventListener);
      this.db.savePoolMessage(msg.pool.address, msg.chatId, msg.id, false);
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
• \`/wallet\` - Monitor wallet positions instead`;
  }
}

module.exports = {
  PoolHandler,
  PoolInfoMessage,
  NoPoolsMessage,
  PoolErrorMessage,
};

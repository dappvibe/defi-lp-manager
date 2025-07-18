/**
 * Telegram Bot Service
 * Object-oriented bot implementation extending TelegramBot
 */
const TelegramBot = require('node-telegram-bot-api');
const { environment } = require('../../config');
const { StartHandler, HelpHandler, NotifyHandler, WalletHandler, LpHandler } = require('./commands');
const Throttler = require('./throttler');
const poolsConfig = require('../../config/pools');
const TelegramMessage = require("./message");
const { PoolInfoMessage, PoolHandler } = require("./commands/pool");

/**
 * Bot class extending TelegramBot with throttling and command handling
 */
class Bot extends TelegramBot {
  /**
   * Initialize the bot
   * @param {string} token - Telegram bot token
   * @param {object} provider - Ethereum provider instance
   * @param {object} mongoose - Mongoose instance
   * @param {object} walletService - Wallet service instance
   * @param {object} options - Additional bot options
   */
  constructor(token, provider, mongoose, walletService, options = {}) {
    // Initialize parent TelegramBot with polling enabled
    super(token, {polling: true, ...options});

    // Store dependencies
    this.provider = provider;
    this.mongoose = mongoose;
    this.walletService = walletService;

    // Initialize throttling
    this.rateLimit = environment.telegram.rateLimit;
    this.throttler = new Throttler({
      maxRequests: this.rateLimit.maxRequestsPerSecond,
      timeWindowMs: 1000
    });

    // Track last edit time for messages
    this.lastEditTimes = {};

    // Initialize the bot
    this.init();
  }

  /**
   * Initialize bot with event handlers and command registration
   */
  init() {
    this.setupEventHandlers();
    this.registerCommandHandlers();
  }

  registerCommandHandlers() {
    this.startHandler = new StartHandler(this, poolsConfig, this.walletService);
    //this.helpHandler = new HelpHandler(this);
    //this.notifyHandler = new NotifyHandler(this, this.monitoredPools);
    this.poolHandler = new PoolHandler(this, this.mongoose, poolsConfig);
    this.walletHandler = new WalletHandler(this, this.walletService);
    this.lpHandler = new LpHandler(this, this.mongoose, this.walletService);
  }

  send(message) {
    try {
      if (!message instanceof TelegramMessage) throw new Error('Invalid message type');

      if (!message.id) {
        return this.sendMessage(message.chatId, message.toString(), message.getOptions()).then(reply => {
          message.id = reply.message_id;
          message.metadata = reply;
          return message;
        });
      } else {
        const options = {
          ...message.getOptions(),
          message_id: message.id,
          chat_id: message.chatId,
        };
        return this.editMessageText(message.toString(), options).then(reply => {
          message.metadata = reply;
          return message;
        });
      }
    } catch (error) {
      console.error('Error sending message:', error);
    }
  }

  /**
   * Throttled version of sendMessage
   * @param {number} chatId - Chat ID
   * @param {string} text - Message text
   * @param {object} options - Message options
   * @returns {Promise} - Promise resolving to sent message
   */
  async sendMessage(chatId, text, options = {}) {
    return this.throttler.throttle(() => super.sendMessage(chatId, text, options));
  }

  /**
   * Throttled version of editMessageText with smart price update handling
   * @param {string} text - New message text
   * @param {object} options - Edit options
   * @returns {Promise} - Promise resolving to edited message
   */
  async editMessageText(text, options = {}) {
    const messageKey = `${options.chat_id || ''}_${options.message_id || ''}`;
    const lastEdit = this.lastEditTimes[messageKey] || 0;
    const timeSinceLastEdit = Date.now() - lastEdit;
    const delayNeeded = Math.max(0, this.rateLimit.messageEditDelay - timeSinceLastEdit);
    if (delayNeeded > 0) {
      // Return a resolved promise to maintain interface consistency
      return Promise.resolve({ message_id: options.message_id });
    }

    // For non-price updates, wait for the required delay
    if (delayNeeded > 0) {
      await new Promise(resolve => setTimeout(resolve, delayNeeded));
    }

    // Update last edit time and throttle the API call
    this.lastEditTimes[messageKey] = Date.now();
    return this.throttler.throttle(() => super.editMessageText(text, options));
  }

  /**
   * Throttled version of answerCallbackQuery
   * @param {string} callbackQueryId - Callback query ID
   * @param {object} options - Answer options
   * @returns {Promise} - Promise resolving to callback answer
   */
  async answerCallbackQuery(callbackQueryId, options = {}) {
    return this.throttler.throttle(() => super.answerCallbackQuery(callbackQueryId, options));
  }

  /**
   * Setup event handlers for bot events
   */
  setupEventHandlers() {
    this.on('polling_start', () => console.log('Telegram Bot started polling'));
    this.on('polling_error', (error) => console.error('Telegram Bot polling error:', error));
  }

  /**
   * Get current throttling statistics
   * @returns {object} - Throttling statistics
   */
  getThrottlingStats() {
    return {
      maxRequestsPerSecond: this.rateLimit.maxRequestsPerSecond,
      messageEditDelay: this.rateLimit.messageEditDelay,
      pendingRequests: this.throttler.getPendingCount ? this.throttler.getPendingCount() : 0
    };
  }

  /**
   * Clean shutdown of the bot
   */
  async shutdown() {
    console.log('Shutting down Bot...');

    // Stop polling
    if (typeof this.stopPolling === 'function') {
      this.stopPolling();
    }

    // Clear any pending timeouts
    this.lastEditTimes = {};

    console.log('Bot shutdown complete.');
  }
}

module.exports = Bot;

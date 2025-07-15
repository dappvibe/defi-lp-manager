/**
 * Telegram Bot Service
 * Object-oriented bot implementation extending TelegramBot
 */
const TelegramBot = require('node-telegram-bot-api');
const { environment } = require('../../config');
const { StartHandler, HelpHandler, NotifyHandler, PoolHandler, WalletHandler, LpHandler } = require('./commands');
const Throttler = require('./throttler');
const poolsConfig = require('../../config/pools');

/**
 * Bot class extending TelegramBot with throttling and command handling
 */
class Bot extends TelegramBot {
  /**
   * Initialize the bot
   * @param {string} token - Telegram bot token
   * @param {object} provider - Ethereum provider instance
   * @param {object} monitoredPools - Object to store monitored pools
   * @param {object} positionMonitor - Position monitor instance
   * @param {object} options - Additional bot options
   */
  constructor(token, provider, monitoredPools, positionMonitor, options = {}) {
    // Initialize parent TelegramBot with polling enabled
    super(token, { polling: true, ...options });

    // Store dependencies
    this.provider = provider;
    this.monitoredPools = monitoredPools;
    this.positionMonitor = positionMonitor;

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
    const now = Date.now();
    const lastEdit = this.lastEditTimes[messageKey] || 0;

    // Calculate delay needed to respect minimum time between edits
    const timeSinceLastEdit = now - lastEdit;
    const delayNeeded = Math.max(0, this.rateLimit.messageEditDelay - timeSinceLastEdit);

    // Check if this is a price update message by looking for specific patterns
    const isPriceUpdate = text.includes('📊 Price:') && text.includes('⏰ Updated:');

    // If this is a price update that would be throttled, discard it
    if (isPriceUpdate && delayNeeded > 0) {
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
   * Throttled version of sendPhoto
   * @param {number} chatId - Chat ID
   * @param {string|Buffer} photo - Photo to send
   * @param {object} options - Photo options
   * @returns {Promise} - Promise resolving to sent photo
   */
  async sendPhoto(chatId, photo, options = {}) {
    return this.throttler.throttle(() => super.sendPhoto(chatId, photo, options));
  }

  /**
   * Setup event handlers for bot events
   */
  setupEventHandlers() {
    this.on('polling_start', () => console.log('Telegram Bot started polling'));
    this.on('polling_error', (error) => console.error('Telegram Bot polling error:', error));
  }

  /**
   * Register all command handlers
   */
  registerCommandHandlers() {
    // Create all handler instances and store them as properties
    this.startHandler = new StartHandler(this, this.monitoredPools, this.positionMonitor);
    this.helpHandler = new HelpHandler(this);
    this.notifyHandler = new NotifyHandler(this, this.monitoredPools);
    this.poolHandler = new PoolHandler(this, this.monitoredPools);
    this.walletHandler = new WalletHandler(this, this.positionMonitor);
    this.lpHandler = new LpHandler(this, this.positionMonitor);
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

    // Clean up handler resources if they have cleanup methods
    if (this.lpHandler && typeof this.lpHandler.cleanup === 'function') {
      this.lpHandler.cleanup();
    }

    if (this.poolHandler && typeof this.poolHandler.cleanup === 'function') {
      this.poolHandler.cleanup();
    }

    console.log('Bot shutdown complete.');
  }
}

module.exports = Bot;

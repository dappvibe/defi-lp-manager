/**
 * Telegram Bot Service
 */
const TelegramBot = require('node-telegram-bot-api');
const { StartHandler, HelpHandler, WalletHandler, LpHandler } = require('./commands');
const Throttler = require('./throttler');
const poolsConfig = require('../../config/pools');
const TelegramMessage = require("./message");
const { PoolHandler } = require("./commands/pool");

/**
 * Bot class extending TelegramBot with throttling and command handling
 */
class Bot extends TelegramBot {
  constructor(config, provider, db, walletRegistry) {
    // Initialize parent TelegramBot with polling enabled
    super(config.telegram.botToken, {polling: true});

    // Store dependencies
    this.config = config;
    this.provider = provider;
    this.db = db;
    this.walletRegistry = walletRegistry;

    // Initialize throttling
    this.rateLimit = this.config.telegram.rateLimit;
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
    new StartHandler(this, poolsConfig, this.walletRegistry);
    new HelpHandler(this);
    new PoolHandler(this, this.db, poolsConfig);
    new WalletHandler(this, this.walletRegistry);
    new LpHandler(this, this.db, this.walletRegistry);
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
}

module.exports = Bot;

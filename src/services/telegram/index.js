/**
 * Telegram client.
 * Polls user input and calls each registered handler with it contents.
 * It is up to the handlers to decide what to do with the input.
 *
 * Provides methods to send messages, edit messages, and answer callback queries.
 *
 * This class is only responsible for networking ops so that it can be mocked in tests.
 * The actual message handling is delegated to the handlers.
 */
const awilix = require("awilix");
const TelegramBot = require('node-telegram-bot-api');
const Throttler = require('./throttler');
const TelegramMessage = require("./message");

class Telegram extends TelegramBot
{
  // Arguments are provided by awilix
  constructor(config, telegramCommands) {
    // Initialize parent TelegramBot with polling enabled
    super(config.telegram.botToken, {autoStart: false});

    this.config = config;
    this.commands = telegramCommands;
    Object.keys(this.commands.registrations).forEach((name) => {
      this.commands.resolve(name).listenOn(this)
    })

    // Initialize throttling
    this.rateLimit = this.config.telegram.rateLimit;
    this.throttler = new Throttler({
      maxRequests: this.rateLimit.maxRequestsPerSecond,
      timeWindowMs: 1000
    });
    this.lastEditTimes = {};
  }

  start() {
    return this.startPolling();
  }

  stop() {
    return this.stopPolling();
  }

  send(message, chatId = null) {
    try {
      if (typeof message === 'string') {
        if (!chatId) throw new Error('Chat ID is required for text messages');
        let text = message;
        message = new class extends TelegramMessage {
          toString() {
            return text;
          }
        }({chatId: chatId});
      }
      if (!message instanceof TelegramMessage) throw new Error('Invalid message type');

      if (!message.id) {
        return this.sendMessage(message.chatId, message.toString(), message.options).then(reply => {
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

}

module.exports = (container) => {
  // Dedicated container to iterate over handlers easily
  const handlers = awilix.createContainer();
  handlers.loadModules(['./commands/*.js'], {
    cwd: __dirname,
    resolverOptions: {
      lifetime: awilix.Lifetime.SINGLETON,
    }
  })
  container.register({
    telegram: awilix.asClass(Telegram).singleton(),
    telegramCommands: awilix.asValue(handlers),
    //throttler: awilix.asClass(Throttler).singleton()
  });
  return container;
}

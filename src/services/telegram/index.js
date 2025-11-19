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

/**
 * @type {EventEmitter}
 */
class Telegram extends TelegramBot
{
  commands = [];

  // Arguments are provided by awilix
  constructor(container) {
    const config = container.resolve('config');
    super(config.telegram.botToken, {autoStart: false});

    this.config = container.resolve('config');

    const commands = Object.keys(container.registrations).filter((key) => key.startsWith('telegramCommand_'));
    commands.forEach((name) => {
      this.addCommand(name.split('_')[1], container.resolve(name));
    })

    // Initialize throttling
    this.rateLimit = this.config.telegram.rateLimit;
    this.throttler = new Throttler({
      maxRequests: this.rateLimit.maxRequestsPerSecond,
      timeWindowMs: 1000
    });
    this.lastEditTimes = {};
  }

  async start() {
    const commands = [];
    for (const cmd of Object.values(this.commands)) {
      const hint = cmd.getMyCommand();
      if (hint) commands.push({command: hint[0], description: hint[1]});
    }
    await this.setMyCommands(commands);
    await this.startPolling();
  }

  async stop() {
    await this.stopPolling();
  }

  /**
   * Registers a new command handler
   * @param {String} name
   * @param {AbstractHandler} handler - Command handler instance
   */
  addCommand(name, handler) {
    this.commands[name] = handler;
    handler.listenOn(this);
    return this;
  }

  send(message, chatId = null) {
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
        ...message.options,
        message_id: message.id,
        chat_id: message.chatId,
      };
      return this.editMessageText(message.toString(), options).then(reply => {
        message.metadata = reply;
        return message;
      });
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
   * Set infinite typing... status. clearInterval(returnValue) to stop.
   * @param {Number} chatId
   * @returns - Interval ID to clear status.
   */
  typing(chatId) {
    this.sendChatAction(chatId, 'typing').then();
    return setInterval(() => this.sendChatAction(chatId, 'typing'), 2500) // 5s is max
  }
}

module.exports = (container) => {
  container.register({
    telegram: awilix.asClass(Telegram).singleton(),
    //throttler: awilix.asClass(Throttler).singleton()
  });
  container.loadModules(['./commands/*.js'], {
    cwd: __dirname,
    formatName: (name) => 'telegramCommand_' + name,
    resolverOptions: {
      lifetime: awilix.Lifetime.SINGLETON,
    }
  })
  return container;
}
module.exports.Telegram = Telegram;

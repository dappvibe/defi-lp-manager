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

  /**
   * @param {TelegramMessage|string} message
   * @param {Number|null} chatId - Required if message is string
   * @return {Promise<unknown>}
   */
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

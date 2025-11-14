const { Telegram } = require('../../../src/services/telegram');

class MockTelegram extends Telegram {
  constructor(...args) {
    super(...args);
    this.sentMessages = [];
    this.editedMessages = [];
    this.callbackAnswers = [];
    this.messageIdCounter = 1;
    this.setMyCommandsCalledWith = [];
  }

  start = vi.fn().mockResolvedValue(this);
  stop = vi.fn().mockResolvedValue(this);

  async send(message, chatId = null) {
    try {
      if (typeof message === 'string') {
        if (!chatId) throw new Error('Chat ID is required for text messages');
        let text = message;
        message = new class extends this.constructor.TelegramMessage {
          toString() {
            return text;
          }
        }({chatId: chatId});
      }

      if (!message.id) {
        const reply = await this.sendMessage(message.chatId, message.toString(), message.options);
        message.id = reply.message_id;
        message.metadata = reply;
        return message;
      } else {
        const options = {
          ...message.getOptions(),
          message_id: message.id,
          chat_id: message.chatId,
        };
        const reply = await this.editMessageText(message.toString(), options);
        message.metadata = reply;
        return message;
      }
    } catch (error) {
      console.error('Error sending message:', error);
    }
  }

  async sendMessage(chatId, text, options = {}) {
    const reply = {
      message_id: this.messageIdCounter++,
      chat: { id: chatId },
      text: text,
      date: Math.floor(Date.now() / 1000),
      ...options
    };
    this.sentMessages.push({ chatId, text, options, reply });
    return reply;
  }

  async editMessageText(text, options = {}) {
    const reply = {
      message_id: options.message_id || this.messageIdCounter++,
      chat: { id: options.chat_id },
      text: text,
      date: Math.floor(Date.now() / 1000),
      edit_date: Math.floor(Date.now() / 1000)
    };
    this.editedMessages.push({ text, options, reply });
    return reply;
  }

  async answerCallbackQuery(callbackQueryId, options = {}) {
    const reply = { ok: true };
    this.callbackAnswers.push({ callbackQueryId, options, reply });
    return reply;
  }
}

module.exports = { MockTelegram };

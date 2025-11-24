const { Telegram } = require('../../../src/services/telegram');

class MockTelegram extends Telegram {
  constructor(container) {
    super(container);
    this.messageIdCounter = 1;

    this.start = vi.fn().mockResolvedValue(this);
    this.stop = vi.fn().mockResolvedValue(this);
    this.sendMessage = vi.fn(this._mockSendMessage.bind(this));
    this.deleteMessage = vi.fn().mockResolvedValue(true);
    this.editMessageText = vi.fn(this._mockEditMessageText.bind(this));
    this.answerCallbackQuery = vi.fn(this._mockAnswerCallbackQuery.bind(this));
  }

  _mockSendMessage(chatId, text, options = {}) {
    const reply = {
      message_id: this.messageIdCounter++,
      chat: { id: chatId },
      text: text,
      date: Math.floor(Date.now() / 1000),
      ...options
    };
    return Promise.resolve(reply);
  }

  _mockEditMessageText(text, options = {}) {
    const reply = {
      message_id: options.message_id || this.messageIdCounter++,
      chat: { id: options.chat_id },
      text: text,
      date: Math.floor(Date.now() / 1000),
      edit_date: Math.floor(Date.now() / 1000)
    };
    return Promise.resolve(reply);
  }

  _mockAnswerCallbackQuery(callbackQueryId, options = {}) {
    return Promise.resolve({ ok: true });
  }

  reset() {
    this.start.mockClear();
    this.stop.mockClear();
    this.sendMessage.mockClear();
    this.editMessageText.mockClear();
    this.answerCallbackQuery.mockClear();
    this.messageIdCounter = 1;
  }
}

module.exports = { MockTelegram };

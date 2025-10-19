class TelegramMessage {
  constructor({id, chatId, metadata} = {}) {
    this.id = id;
    this.chatId = chatId;
    this.metadata = metadata;
  }

  get options() {};
}

module.exports = TelegramMessage;

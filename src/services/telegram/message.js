class TelegramMessage {
  constructor({id, chatId, metadata} = {}) {
    this.id = id;
    this.chatId = chatId;
    this.metadata = metadata;
  }

  get options() {};

  /**
   * Simple fingerprint of message contents to detect duplicates.
   * @returns {number}
   */
  checksum() {
    const str = this.toString();
    let sum = 0;
    if (str.length === 0) return sum;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      sum = ((sum << 5) - sum) + char; // sum * 31 + char
      sum |= 0; // Convert to a 32bit integer
    }
    return sum;
  }
}

module.exports = TelegramMessage;

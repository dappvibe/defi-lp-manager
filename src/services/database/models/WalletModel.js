const {Schema} = require("mongoose");

const walletSchema = new Schema({
  address: { type: String, required: true, index: true, set: v => v.toLowerCase() },
  chatId: { type: Number, required: true, index: true },
  addedAt: { type: Date, default: Date.now },
  lastUpdated: { type: Date, default: Date.now }
});

// Compound index for unique wallet-chat pairs
walletSchema.index({ address: 1, chatId: 1 }, { unique: true });

// Pre-find hook
walletSchema.pre(['find', 'findOne'], function (next) {
  if (this._conditions.address) {
    this._conditions.address = this._conditions.address.toLowerCase();
  }
  next();
});

class WalletModel {
  /**
   * Get all monitored wallets for a specific chat
   * @param {number} chatId - Telegram chat ID
   * @returns {Promise<Array<string>>} - Array of wallet addresses
   */
  static async getForChat(chatId) {
    try {
      const wallets = await this.find({ chatId }).lean();
      return wallets.map(w => w.address);
    } catch (error) {
      console.error('Error getting wallets for chat:', error);
      return [];
    }
  }

  /**
   * Get all monitored wallets across all chats
   * @returns {Promise<Array<string>>} - Array of unique wallet addresses
   */
  static async getAll() {
    try {
      return await this.distinct('address');
    } catch (error) {
      console.error('Error getting all monitored wallets:', error);
      return [];
    }
  }
}

walletSchema.loadClass(WalletModel);

module.exports = (mongoose) => mongoose.model('Wallet', walletSchema);

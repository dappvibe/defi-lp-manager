const {Schema} = require("mongoose");

const walletSchema = new Schema({
  address: { type: String, required: true, index: true },
  chatId: { type: Number, required: true, index: true },
  addedAt: { type: Date, default: Date.now },
  lastUpdated: { type: Date, default: Date.now }
});

// Compound index for unique wallet-chat pairs
walletSchema.index({ address: 1, chatId: 1 }, { unique: true });

class WalletModel {
  async all() {
    try {
      return await WalletModel.find({}).lean();
    } catch (error) {
      console.error('Error getting monitored wallets:', error);
      return [];
    }
  }

  async save(address, chatId) {
    try {
      await WalletModel.findOneAndUpdate(
        { address, chatId },
        {
          address,
          chatId,
          lastUpdated: new Date()
        },
        { upsert: true, new: true }
      );
    } catch (error) {
      console.error('Error saving monitored wallet:', error);
      throw error;
    }
  }

  async remove(address, chatId) {
    try {
      await WalletModel.deleteOne({
        address,
        chatId
      });
    } catch (error) {
      console.error('Error removing monitored wallet:', error);
      throw error;4
    }
  }

  static async getAllMonitoredWallets() {
    try {
      return await this.find({}).lean();
    } catch (error) {
      console.error('Error getting monitored wallets:', error);
      return [];
    }
  }

  async saveMonitoredWallet(address, chatId) {
    try {
      await Wallet.findOneAndUpdate(
        { address, chatId },
        {
          address,
          chatId,
          lastUpdated: new Date()
        },
        { upsert: true, new: true }
      );
    } catch (error) {
      console.error('Error saving monitored wallet:', error);
      throw error;
    }
  }

  async removeMonitoredWallet(address, chatId) {
    try {
      await Wallet.deleteOne({
        address,
        chatId
      });
    } catch (error) {
      console.error('Error removing monitored wallet:', error);
      throw error;
    }
  }

  // Legacy compatibility methods
  get walletsCollection() {
    return {
      find: (query) => ({
        toArray: () => Wallet.find(query).lean()
      }),
      updateOne: (filter, update, options) =>
        Wallet.findOneAndUpdate(filter, update.$set, { upsert: options?.upsert }),
      deleteOne: (filter) => Wallet.deleteOne(filter)
    };
  }

  // Legacy compatibility methods for existing code
  get collection() {
    return {
      find: (query) => ({
        toArray: () => WalletModel.find(query).lean()
      }),
      updateOne: (filter, update, options) =>
        WalletModel.findOneAndUpdate(filter, update.$set, { upsert: options?.upsert }),
      deleteOne: (filter) => WalletModel.deleteOne(filter)
    };
  }
}

walletSchema.loadClass(WalletModel);

module.exports = (mongoose) => mongoose.model('Wallet', walletSchema);

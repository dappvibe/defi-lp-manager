const { Schema } = require('mongoose');

/**
 * Store user information linked to Telegram accounts.
 *
 * @property {String} _id - Auto-generated MongoDB ObjectId
 * @property {Number} telegramId - Telegram user ID (unique)
 * @property {Promise<WalletModel[]>} wallets - Associated wallets (virtual)
 * @property {Date} createdAt - Creation timestamp
 * @property {Date} updatedAt - Last update timestamp
 */
class UserModel {
  static schema = new Schema({
    telegramId: { type: Number, required: true, index: true, unique: true },
  }, { timestamps: true });

  static {
    UserModel.schema.virtual('wallets', {
      ref: 'Wallet',
      localField: '_id',
      foreignField: 'userId',
      justOne: false,
      options: {
        sort: { createdAt: -1 }
      }
    });
  }
}

module.exports = (mongoose) => {
  return mongoose.model('User', UserModel.schema.loadClass(UserModel));
}

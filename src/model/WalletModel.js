const {Schema} = require("mongoose");

/**
 * Store wallet information linked to users.
 *
 * @property {String} _id - Composite key in format chainId:address
 * @property {Number} chainId - Blockchain chain ID
 * @property {String} address - Wallet address (lowercase)
 * @property {String} userId - Associated user ID
 * @property {Date} createdAt - Creation timestamp
 * @property {Date} updatedAt - Last update timestamp
 */
class WalletModel {
  static schema = new Schema({
    _id: String, // chainId:address
    chainId: { type: Number, required: true },
    address: { type: String, required: true, index: true, set: v => v.toLowerCase() },
    userId: { type: String, required: true, ref: 'User' },
  }, { _id: false, timestamps: true });

  static {
    WalletModel.schema.index({ userId: 1, createdAt: -1 });

    WalletModel.schema.pre('validate', function() {
      if (!this._id) {
        this._id = `${this.chainId}:${this.address}`;
      }
    });

    WalletModel.schema.pre(['find', 'findOne'], function (next) {
      if (this._conditions.address) {
        this._conditions.address = this._conditions.address.toLowerCase();
      }
      next();
    });
  }
}

module.exports = (mongoose) => {
  return mongoose.model('Wallet', WalletModel.schema.loadClass(WalletModel));
}

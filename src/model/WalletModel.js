const {Schema} = require("mongoose");

const walletSchema = new Schema({
  _id: { type: String },
  chainId: { type: Number, required: true },
  address: { type: String, required: true, index: true, set: v => v.toLowerCase() },
  userId: { type: String, required: true, ref: 'User' }, // do not autopopulate as rarely needed
}, { _id: false, timestamps: true });

// Auto-generate _id as chainId:address
walletSchema.pre('validate', function() {
  if (!this._id) {
    this._id = `${this.chainId}:${this.address}`;
  }
});

walletSchema.index({ userId: 1, createdAt: -1 });

// Lowercase address in query
walletSchema.pre(['find', 'findOne'], function (next) {
  if (this._conditions.address) {
    this._conditions.address = this._conditions.address.toLowerCase();
  }
  next();
});

class WalletModel {
}

walletSchema.loadClass(WalletModel);

module.exports = (mongoose) => mongoose.model('Wallet', walletSchema);

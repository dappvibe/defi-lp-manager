const mongoose = require('mongoose');

const walletSchema = new mongoose.Schema({
  address: { type: String, required: true, index: true },
  chatId: { type: Number, required: true, index: true },
  addedAt: { type: Date, default: Date.now },
  lastUpdated: { type: Date, default: Date.now }
});

// Compound index for unique wallet-chat pairs
walletSchema.index({ address: 1, chatId: 1 }, { unique: true });

module.exports = mongoose.model('Wallet', walletSchema);

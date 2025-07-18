const mongoose = require('mongoose');

const positionSchema = new mongoose.Schema({
  tokenId: { type: String, required: true, index: true },
  walletAddress: { type: String, required: true, index: true },
  poolAddress: { type: String, index: true },
  chatId: { type: Number, index: true },
  messageId: { type: Number, index: true },
  token0Symbol: String,
  token1Symbol: String,
  updatedAt: { type: Date, default: Date.now }
});

// Compound indexes
positionSchema.index({ walletAddress: 1, tokenId: 1 }, { unique: true });

module.exports = mongoose.model('Position', positionSchema);

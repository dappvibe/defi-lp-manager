const mongoose = require('mongoose');

const tokenSchema = new mongoose.Schema({
  address: { type: String, required: true, index: true },
  chainId: { type: Number, required: true, index: true },
  symbol: { type: String, required: true, index: true },
  decimals: { type: Number, required: true },
  name: String,
  cachedAt: { type: Date, default: Date.now, index: true }
});

// Compound index for unique address-chainId pairs
tokenSchema.index({ address: 1, chainId: 1 }, { unique: true });

module.exports = mongoose.model('Token', tokenSchema);

const mongoose = require('mongoose');

const poolSchema = new mongoose.Schema({
  address: { type: String, required: true, unique: true, index: true },
  token0: { type: String, required: true, index: true },
  token1: { type: String, required: true, index: true },
  fee: { type: Number, required: true },
  tickSpacing: Number,
  unlocked: Boolean,
  platform: { type: String, index: true },
  blockchain: { type: String, index: true },
  configName: String,
  configDescription: String,
  lastPriceT1T0: String,
  priceMonitoringEnabled: { type: Boolean, default: false },
  cachedAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

// Compound indexes
poolSchema.index({ token0: 1, token1: 1 });
poolSchema.index({ platform: 1, blockchain: 1 });

module.exports = mongoose.model('Pool', poolSchema);

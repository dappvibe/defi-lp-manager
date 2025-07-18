const mongoose = require('mongoose');

const tokenSchema = new mongoose.Schema({
  address: { type: String, required: true },
  symbol: { type: String, required: true },
  decimals: { type: Number, required: true },
  name: String
}, { _id: false });

const poolSchema = new mongoose.Schema({
  poolAddress: { type: String, required: true, unique: true, index: true },
  token0: { type: tokenSchema, required: true },
  token1: { type: tokenSchema, required: true },
  fee: { type: Number, required: true },
  tickSpacing: Number,
  sqrtPriceX96: String,
  tick: Number,
  observationIndex: Number,
  observationCardinality: Number,
  observationCardinalityNext: Number,
  feeProtocol: Number,
  unlocked: Boolean,
  platform: { type: String, index: true },
  blockchain: { type: String, index: true },
  configName: String,
  configDescription: String,
  lastPriceT1T0: String,
  notifications: [String],
  priceMonitoringEnabled: { type: Boolean, default: false },
  cachedAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

// Compound indexes
poolSchema.index({ 'token0.address': 1, 'token1.address': 1 });
poolSchema.index({ 'token0.symbol': 1, 'token1.symbol': 1 });
poolSchema.index({ platform: 1, blockchain: 1 });

// Individual token indexes
poolSchema.index({ 'token0.address': 1 });
poolSchema.index({ 'token1.address': 1 });
poolSchema.index({ 'token0.symbol': 1 });
poolSchema.index({ 'token1.symbol': 1 });

module.exports = mongoose.model('Pool', poolSchema);

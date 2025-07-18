const mongoose = require('mongoose');

const poolMessageSchema = new mongoose.Schema({
  poolAddress: { type: String, required: true, index: true },
  chatId: { type: Number, required: true, index: true },
  messageId: { type: Number, required: true, index: true },
  isMonitored: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

// Compound indexes
poolMessageSchema.index({ poolAddress: 1, chatId: 1 }, { unique: true });

module.exports = mongoose.model('PoolMessage', poolMessageSchema);

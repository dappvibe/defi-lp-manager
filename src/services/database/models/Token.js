const mongoose = require('mongoose');

const tokenSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  address: { type: String, required: true, unique: true, index: true },
  chainId: { type: Number, required: true, index: true },
  symbol: { type: String, required: true, index: true },
  decimals: { type: Number, required: true },
  name: String,
  cachedAt: { type: Date, default: Date.now, index: true }
}, { _id: false });

// Set address as the primary key
tokenSchema.pre('save', function() {
  this._id = this.address;
});

module.exports = mongoose.model('Token', tokenSchema);

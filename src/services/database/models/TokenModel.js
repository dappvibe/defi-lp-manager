const {Schema} = require("mongoose");
const {Token} = require("@uniswap/sdk-core");

const tokenSchema = new Schema({
  _id: String,
  name: String,
  symbol: String,
  decimals: Number,
}, { _id: false });

tokenSchema.virtual('chainId').get(function() { return +this._id.split(':')[0]; });
tokenSchema.virtual('address').get(function() { return this._id.split(':')[1]; });

class TokenModel {
  /**
   * _id must be manually set on doc creation
   * @param chainId
   * @param address
   * @return {string}
   */
  static id(chainId, address) { return `${chainId}:${address.toLowerCase()}`; }

  toToken() {
    return new Token(this.chainId, this.address, this.decimals, this.symbol, this.name);
  }
}

tokenSchema.loadClass(TokenModel);
module.exports = (mongoose) => mongoose.model('Token', tokenSchema);

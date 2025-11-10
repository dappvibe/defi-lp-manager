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
  static chainId;
  static erc20Factory;

  /**
   * _id must be manually set on doc creation
   * @param chainId
   * @param address
   * @return {string}
   */
  static id(chainId, address) { return `${chainId}:${address.toLowerCase()}`; }

  static async findOrCreate(chainId, address) {
    address = address.toLowerCase();

    const _id = this.id(chainId, address);

    let doc = await this.findById(_id);
    if (!doc) {
      const contract = TokenModel.erc20Factory(address);
      const [symbol, decimals, name] = await Promise.all([
        contract.read.symbol(),
        contract.read.decimals(),
        contract.read.name()
      ]);
      doc = await this.create({ _id, symbol, decimals, name });
    }

    // Until app wants to send tokens or check balance ERC20 contract is not attached

    return doc;
  }

  toToken() {
    return new Token(this.chainId, this.address, this.decimals, this.symbol, this.name);
  }
}

tokenSchema.loadClass(TokenModel);

module.exports = function(mongoose, chainId, erc20Factory) {
  TokenModel.chainId = chainId;
  TokenModel.erc20Factory = erc20Factory;
  return mongoose.model('Token', tokenSchema);
}

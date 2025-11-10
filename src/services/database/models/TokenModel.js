const {Schema} = require("mongoose");
const {Token} = require("@uniswap/sdk-core");

const tokenSchema = new Schema({
  _id: String,
  chainId: Number,
  name: String,
  symbol: String,
  decimals: Number,
}, { _id: false });

tokenSchema.virtual('address').get(function() { return this._id.split(':')[1]; });

class TokenModel {
  static chainId;
  static erc20Factory;

  getId() {
    return TokenModel.id(this.chainId, this.address);
  }

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
      doc = this.fromBlockchain(address);
      await doc.save();
    }

    // Until app wants to send tokens or check balance ERC20 contract is not attached

    return doc;
  }

  /**
   * @param address
   * @return {Promise<TokenModel>}
   */
  static async fromBlockchain(address) {
    const contract = TokenModel.erc20Factory(address);
    const doc = new this;
    await Promise.all([
      contract.provider.getChainId().then(c => doc.chainId = c),
      contract.read.symbol().then(s => doc.symbol = s),
      contract.read.decimals().then(d => doc.decimals = d),
      contract.read.name().then(n => doc.name = n)
    ]);
    doc._id = this.id(doc.chainId, address);
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

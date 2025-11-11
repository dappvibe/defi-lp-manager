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

/**
 * @property {String} _id - Composite key in format chainId:address
 * @property {Number} chainId - Chain identifier
 * @property {String} name - Token name
 * @property {String} symbol - Token symbol
 * @property {Number} decimals - Token decimals
 * @property {String} address - Virtual property returning token address
 */
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
      doc = await this.fromBlockchain(address);
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
    doc.chainId = TokenModel.chainId;
    await Promise.all([
      contract.read.symbol().then(s => doc.symbol = s),
      contract.read.decimals().then(d => doc.decimals = d),
      contract.read.name().then(n => doc.name = n)
    ]);
    doc._id = this.id(doc.chainId, address);
    return doc;
  }

  toUniswapSDK() {
    return new Token(this.chainId, this.address, this.decimals, this.symbol, this.name);
  }

  getFloatAmount(amount) {
    const result = Number(amount) / Math.pow(10, this.decimals);
    return result.toFixed(this.decimals);
  }
}

tokenSchema.loadClass(TokenModel);

module.exports = function(mongoose, chainId, erc20Factory) {
  TokenModel.chainId = chainId;
  TokenModel.erc20Factory = erc20Factory;

  const attachContact = function(doc) {
    doc.contract = erc20Factory(doc.address);
    return doc;
  }
  tokenSchema.post('init', attachContact)
  tokenSchema.post('save', attachContact)

  return mongoose.model('Token', tokenSchema);
}

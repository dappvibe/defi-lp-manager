const {Schema} = require("mongoose");
const {Token} = require("@uniswap/sdk-core");
const {formatUnits} = require('viem');

const tokenSchema = new Schema({
  _id: {type: String, required: true},
  chainId: {type: Number, required: true},
  name: {type: String, required: true},
  symbol: {type: String, required: true},
  decimals: {type: Number, required: true},
}, {_id: false});

tokenSchema.virtual('address').get(function() {
  return this._id.split(':')[1];
});

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

  get id() {
    return TokenModel.id(this.chainId, this.address);
  }

  /**
   * _id must be manually set on doc creation
   * @param chainId
   * @param address
   * @return {string}
   */
  static id(chainId, address) {
    return `${chainId}:${address.toLowerCase()}`;
  }

  /**
   * Find doc in the db and if not exists get details from blockchain, save and return doc.
   *
   * @param address
   * @return {Promise<TokenModel>}
   */
  static async fetch(address) {
    address = address.toLowerCase();

    const _id = this.id(TokenModel.chainId, address);
    let doc = await this.findById(_id);
    if (!doc) {
      doc = await this.fromBlockchain(address);
      try {
        await doc.save();
      } catch (e) {
        if (e.code === 11000) { // duplicate (race condition)
          doc = await this.findById(_id);
          if (!doc) throw new Error(`Token with _id ${_id} was concurrently created but not found after retry.`);
        }
        else throw e;
      }
    }

    // ERC20 contract is attached in hooks (see exports)
    return doc;
  }

  /**
   * Fetch token details from blockchain and return unsaved doc.
   * Use static chainId in this class, retreived from container.
   *
   * @param {String} address Case-insensitive
   * @return {Promise<TokenModel>}
   */
  static async fromBlockchain(address) {
    const doc = new this;
    doc.chainId = TokenModel.chainId;
    doc._id = this.id(doc.chainId, address);

    const contract = TokenModel.erc20Factory(address);
    await Promise.all([
      contract.read.symbol().then(s => doc.symbol = s),
      contract.read.decimals().then(d => doc.decimals = d),
      contract.read.name().then(n => doc.name = n)
    ]);

    return doc;
  }

  toUniswapSDK() {
    return new Token(this.chainId, this.address, this.decimals, this.symbol, this.name);
  }

  getFloatAmount(amount) {
    return formatUnits(amount, this.decimals);
  }
}

tokenSchema.loadClass(TokenModel);

module.exports = function(mongoose, chainId, erc20Factory) {
  TokenModel.chainId = chainId;
  TokenModel.erc20Factory = erc20Factory;

  const attachContract = function(doc) {
    doc.contract = erc20Factory(doc.address);
  }
  tokenSchema.post('init', attachContract)
  tokenSchema.post('save', attachContract)

  return mongoose.model('Token', tokenSchema);
}

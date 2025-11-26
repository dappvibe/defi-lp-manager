const {Schema} = require("mongoose");
const {Token} = require("@uniswap/sdk-core");
const {formatUnits} = require('viem');

/**
 * @property {String} _id - Composite key in format chainId:address
 * @property {Number} chainId - Chain identifier
 * @property {String} name - Token name
 * @property {String} symbol - Token symbol
 * @property {Number} decimals - Token decimals
 * @property {String} address - Virtual property returning token address
 * @property {Object} contract - Instance of ERC20 contract
 * @static {Function} erc20Factory - ERC20 contract factory function
 * @static {Schema} schema - Mongoose schema
 */
class TokenModel
{
  static schema = new Schema({
    _id: {type: String, required: true}, // chainId:address
    name: {type: String, required: true},
    symbol: {type: String, required: true},
    decimals: {type: Number, required: true},
  }, {_id: false});

  static erc20Factory;

  static {
    TokenModel.schema.post(['init', 'save'], function(doc) {
      doc.contract = TokenModel.erc20Factory(doc.address);
    });
  }

  get chainId() {
    return Number(this._id.split(':')[0]);
  }
  get address() {
    return this._id.split(':')[1];
  }

  format(amount) {
    return formatUnits(amount, this.decimals);
  }

  /**
   * Read token balance from blockchain.
   * @param address
   * @return {Promise<string>}
   */
  async getBalance(address) {
    return this.contract.read.balanceOf([address]);
  }

  toUniswapSDK() {
    return new Token(this.chainId, this.address, this.decimals, this.symbol, this.name);
  }

  /**
   * Fetch token details from blockchain and return unsaved doc.
   * @return {Promise<TokenModel>}
   * @param id
   */
  static async fromBlockchain(id) {
    let chainId, address;
    try { [chainId, address] = id.split(':'); }
    catch (e) { throw new Error('Invalid TokenModel: ' + id); }

    const contract = TokenModel.erc20Factory(address);
    const [name, symbol, decimals] = await Promise.all([
      contract.read.name(),
      contract.read.symbol(),
      contract.read.decimals()
    ]);

    const token = new this({
      _id: id,
      name,
      symbol,
      decimals
    });
    token.contract = contract;
    return token;
  }
}

/**
  * @param mongoose - Mongoose connection
  * @param erc20Factory - ERC20 contract factory function
  * @return {TokenModel}
  */
module.exports = function(mongoose, erc20Factory) {
  TokenModel.erc20Factory = erc20Factory;

  return mongoose.model('Token', TokenModel.schema.loadClass(TokenModel));
};

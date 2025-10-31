const awilix = require('awilix');
const { Token } = require('@uniswap/sdk-core');

Token.prototype.toString = function() { return this.address.toLowerCase(); };

class TokenService
{
  constructor(erc20Factory, tokenModel, chainId) {
    this.chainId = chainId;
    this.erc20Factory = erc20Factory;
    this.model = tokenModel;
  }

  /**
   *
   * @param address
   * @return {Promise<*|Token>} Uniswap Token instance
   */
  async get(address) {
    const _id = this.model.id(this.chainId, address);
    const contract = this.erc20Factory(address);

    let doc = await this.model.findById(_id);
    if (!doc) {
      const [symbol, decimals, name] = await Promise.all([
        contract.read.symbol(),
        contract.read.decimals(),
        contract.read.name()
      ]);
      doc = await this.model.create({ _id, symbol, decimals, name });
    }

    const token = doc.toToken();
    token.abi = contract;
    return token;
  }
}

/**
 * Register factory that loads token class from model or blockchain with for given address.
 * @param container
 */
module.exports = (container) => {
  container.register({
    tokens: awilix.asClass(TokenService).singleton()
  })
};

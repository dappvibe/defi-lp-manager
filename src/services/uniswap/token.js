const awilix = require('awilix');
const { Token } = require('@uniswap/sdk-core');

class TokenService {
  constructor(erc20Factory, tokenModel) {
    this.chainId = 42161; // FIXME
    this.erc20Factory = erc20Factory;
    this.model = tokenModel;

    this.tokens = new Map(); // Keep in-memory cache for performance
  }

  /**
   *
   * @param address
   * @return {Promise<*|Token>} Uniswap Token instance
   */
  async get(address) {
    if (this.tokens.has(address)) return this.tokens.get(address);

    let token;
    const contract = this.erc20Factory(address);

    // Check MongoDB cache
    const row = await this.model.get(address);
    if (row) {
      token = new Token(row.chainId, row.address, row.decimals, row.symbol, row.name);
    }
    else {
      const [symbol, decimals, name] = await Promise.all([
        contract.read.symbol(),
        contract.read.decimals(),
        contract.read.name()
      ]);
      token = new Token(this.chainId, address, decimals, symbol, name);
      await this.model.save(address, this.chainId, { symbol, decimals, name });
    }

    token.contract = contract;

    this.tokens.set(address, token);
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

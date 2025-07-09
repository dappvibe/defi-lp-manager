/**
 * ABI index file
 * Central export for all contract ABIs
 */
const erc20Abi = require('./erc20.json');
const uniswapV3PoolAbi = require('./v3-pool.json');

module.exports = {
  erc20: erc20Abi,
  uniswapV3Pool: uniswapV3PoolAbi
};

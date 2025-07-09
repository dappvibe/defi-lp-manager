/**
 * Contract interaction service
 * Handles creation and interaction with Ethereum contracts
 */
const { getContract } = require('viem');
const { getProvider } = require('../blockchain/provider');
const { erc20: erc20Abi, uniswapV3Pool: poolAbi } = require('./abis');

/**
 * Create an ERC20 token contract instance
 * @param {string} tokenAddress - The token contract address
 * @returns {Object} The contract instance
 */
function createErc20Contract(tokenAddress) {
  const client = getProvider();
  return getContract({
    address: tokenAddress,
    abi: erc20Abi,
    client
  });
}

/**
 * Create a Uniswap V3 pool contract instance
 * @param {string} poolAddress - The pool contract address
 * @returns {Object} The contract instance
 */
function createPoolContract(poolAddress) {
  const client = getProvider();
  return getContract({
    address: poolAddress,
    abi: poolAbi,
    client
  });
}

/**
 * Get token information (symbol, decimals)
 * @param {string} tokenAddress - The token contract address
 * @returns {Promise<Object>} Token information
 */
async function getTokenInfo(tokenAddress) {
  const tokenContract = createErc20Contract(tokenAddress);

  try {
    const [symbol, decimals] = await Promise.all([
      tokenContract.read.symbol(),
      tokenContract.read.decimals()
    ]);

    return {
      address: tokenAddress,
      symbol,
      decimals
    };
  } catch (error) {
    console.error(`Error fetching token info for ${tokenAddress}:`, error);
    throw error;
  }
}

module.exports = {
  createErc20Contract,
  createPoolContract,
  getTokenInfo
};

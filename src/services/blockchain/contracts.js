/**
 * Contract interaction service
 * Handles creation and interaction with Ethereum contracts
 */
const { ethers } = require('ethers');
const { getProvider } = require('./provider');
const { erc20: erc20Abi, uniswapV3Pool: poolAbi } = require('../../../data/abis');

/**
 * Create an ERC20 token contract instance
 * @param {string} tokenAddress - The token contract address
 * @returns {ethers.Contract} The contract instance
 */
function createErc20Contract(tokenAddress) {
  const provider = getProvider();
  return new ethers.Contract(tokenAddress, erc20Abi, provider);
}

/**
 * Create a Uniswap V3 pool contract instance
 * @param {string} poolAddress - The pool contract address
 * @returns {ethers.Contract} The contract instance
 */
function createPoolContract(poolAddress) {
  const provider = getProvider();
  return new ethers.Contract(poolAddress, poolAbi, provider);
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
      tokenContract.symbol(),
      tokenContract.decimals()
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

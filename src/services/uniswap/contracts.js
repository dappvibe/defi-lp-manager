/**
 * Contract interaction service
 * Handles creation and interaction with Ethereum contracts
 */
const { getContract } = require('viem');
const { getProvider } = require('../blockchain/provider');
const { erc20: erc20Abi, uniswapV3Pool: poolAbi } = require('./abis');

// Import additional ABIs
const positionManagerAbi = require('./abis/v3-position-manager.json');
const stakingAbi = require('./abis/masterchef-v3.json');
const factoryAbi = require('./abis/v3-factory.json');

// Contract addresses for PancakeSwap on Arbitrum
const CONTRACT_ADDRESSES = {
  pancakeswap: {
    arbitrum: {
      nonfungiblePositionManager: '0x46A15B0b27311cedF172AB29E4f4766fbE7F4364',
      masterChefV3: '0x5e09acf80c0296740ec5d6f643005a4ef8daa694',
      V3Factory: '0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865'
    }
  }
};

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
 * Create a Uniswap V3 position manager contract instance
 * @returns {Object} The position manager contract instance
 */
function createPositionManagerContract() {
  const client = getProvider();
  const positionManagerAddress = CONTRACT_ADDRESSES.pancakeswap.arbitrum.nonfungiblePositionManager;

  return getContract({
    address: positionManagerAddress,
    abi: positionManagerAbi,
    client
  });
}

/**
 * Create a staking contract instance (MasterChef V3)
 * @returns {Object} The staking contract instance
 */
function createStakingContract() {
  const client = getProvider();
  const stakingContractAddress = CONTRACT_ADDRESSES.pancakeswap.arbitrum.masterChefV3;

  return getContract({
    address: stakingContractAddress,
    abi: stakingAbi,
    client
  });
}

/**
 * Create a Uniswap V3 factory contract instance
 * @returns {Object} The factory contract instance
 */
function createFactoryContract() {
  const client = getProvider();
  const factoryAddress = CONTRACT_ADDRESSES.pancakeswap.arbitrum.V3Factory;

  return getContract({
    address: factoryAddress,
    abi: factoryAbi,
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
  createPositionManagerContract,
  createStakingContract,
  createFactoryContract,
  getTokenInfo
};

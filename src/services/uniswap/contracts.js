/**
 * Contract interaction service
 * Handles creation and interaction with Ethereum contracts
 */
const { getContract } = require('viem');
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
 * Contract service class with dependency injection
 */
class ContractsService {
  /**
   * Create a new ContractsService instance
   */
  constructor(provider) {
    this.provider = provider;
  }

  /**
   * Create an ERC20 token contract instance
   * @param {string} tokenAddress - The token contract address
   * @returns {Object} The contract instance
   */
  createErc20Contract(tokenAddress) {
    return getContract({
      address: tokenAddress,
      abi: erc20Abi,
      client: this.provider
    });
  }

  /**
   * Create a Uniswap V3 pool contract instance
   * @param {string} poolAddress - The pool contract address
   * @returns {Object} The contract instance
   */
  createPoolContract(poolAddress) {
    return getContract({
      address: poolAddress,
      abi: poolAbi,
      client: this.provider
    });
  }

  /**
   * Create a Uniswap V3 position manager contract instance
   * @returns {Object} The position manager contract instance
   */
  createPositionManagerContract() {
    const positionManagerAddress = CONTRACT_ADDRESSES.pancakeswap.arbitrum.nonfungiblePositionManager;

    return getContract({
      address: positionManagerAddress,
      abi: positionManagerAbi,
      client: this.provider
    });
  }

  /**
   * Create a staking contract instance (MasterChef V3)
   * @returns {Object} The staking contract instance
   */
  createStakingContract() {
    const stakingContractAddress = CONTRACT_ADDRESSES.pancakeswap.arbitrum.masterChefV3;

    return getContract({
      address: stakingContractAddress,
      abi: stakingAbi,
      client: this.provider
    });
  }

  /**
   * Create a Uniswap V3 factory contract instance
   * @returns {Object} The factory contract instance
   */
  createFactoryContract() {
    const factoryAddress = CONTRACT_ADDRESSES.pancakeswap.arbitrum.V3Factory;

    return getContract({
      address: factoryAddress,
      abi: factoryAbi,
      client: this.provider
    });
  }

  /**
   * Get token information (symbol, decimals)
   * @param {string} tokenAddress - The token contract address
   * @returns {Promise<Object>} Token information
   */
  async getTokenInfo(tokenAddress) {
    const tokenContract = this.createErc20Contract(tokenAddress);

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
}

module.exports = ContractsService;

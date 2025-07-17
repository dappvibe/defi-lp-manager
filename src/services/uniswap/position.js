const { getContract } = require('viem');
const { contracts } = require('../../config');
const { Pool } = require('@uniswap/v3-sdk');
const { Token } = require('@uniswap/sdk-core');
const {EventEmitter} = require('events');

const { tickToHumanPrice, isPositionInRange } = require('./helpers');
const TokenService = require('./token');
const { getProvider } = require('../blockchain/provider');
const { Position: UniswapPosition } = require('@uniswap/v3-sdk');

class Position extends EventEmitter {
  /**
   * Create a new Position instance
   * @param {Object} positionData - Position data object
   * @param {object} provider - Blockchain provider (optional)
   */
  constructor(positionData, provider = null) {
    super();
    // Position properties
    this.tokenId = positionData.tokenId;
    this.token0 = positionData.token0;
    this.token1 = positionData.token1;
    this.token0Symbol = positionData.token0Symbol;
    this.token1Symbol = positionData.token1Symbol;
    this.token0Decimals = positionData.token0Decimals;
    this.token1Decimals = positionData.token1Decimals;
    this.fee = positionData.fee;
    this.tickLower = positionData.tickLower;
    this.tickUpper = positionData.tickUpper;
    this.currentTick = positionData.currentTick;
    this.liquidity = positionData.liquidity;
    this.token0Amount = positionData.token0Amount;
    this.token1Amount = positionData.token1Amount;
    this.lowerPrice = positionData.lowerPrice;
    this.upperPrice = positionData.upperPrice;
    this.currentPrice = positionData.currentPrice;
    this.inRange = positionData.inRange;
    this.isStaked = positionData.isStaked || false;
    this.token0Instance = positionData.token0Instance;
    this.token1Instance = positionData.token1Instance;
    this.walletAddress = positionData.walletAddress;
    this.poolAddress = positionData.poolAddress;

    // Provider for refreshing data
    this.provider = provider || getProvider();
  }

  /**
   * Static contracts - initialized lazily
   */
  static _positionManagerContract = null;
  static _stakingContract = null;
  static _tokenService = null;
  static _provider = null;

  /**
   * Get or create provider instance
   * @returns {object} Provider instance
   */
  static getProvider() {
    if (!Position._provider) {
      Position._provider = getProvider();
    }
    return Position._provider;
  }

  /**
   * Get or create position manager contract
   * @returns {object} Position manager contract
   */
  static getPositionManagerContract() {
    if (!Position._positionManagerContract) {
      const positionManagerAddress = contracts.getContractAddress('pancakeswap', 'arbitrum', 'nonfungiblePositionManager');
      const positionManagerAbi = require('./abis/v3-position-manager.json');

      Position._positionManagerContract = getContract({
        address: positionManagerAddress,
        abi: positionManagerAbi,
        client: Position.getProvider()
      });
    }
    return Position._positionManagerContract;
  }

  /**
   * Get or create staking contract
   * @returns {object|null} Staking contract or null if not available
   */
  static getStakingContract() {
    if (!Position._stakingContract) {
      try {
        const stakingContractAddress = contracts.getContractAddress('pancakeswap', 'arbitrum', 'masterChefV3');
        const stakingAbi = require('./abis/masterchef-v3.json');

        Position._stakingContract = getContract({
          address: stakingContractAddress,
          abi: stakingAbi,
          client: Position.getProvider()
        });
      } catch (error) {
        console.warn('Staking contract not available:', error.message);
        Position._stakingContract = null;
      }
    }
    return Position._stakingContract;
  }

  /**
   * Get or create token service
   * @returns {TokenService} Token service instance
   */
  static getTokenService() {
    if (!Position._tokenService) {
      Position._tokenService = new TokenService(Position.getProvider());
    }
    return Position._tokenService;
  }

  /**
   * Fetch all positions for a wallet (static method)
   * @param {string} walletAddress - Wallet address
   * @returns {Promise<Array<Position>>} Array of Position instances
   */
  static async fetchPositions(walletAddress) {
    try {
      // Get both unstaked and staked positions
      const [unstakedPositions, stakedPositions] = await Promise.all([
        Position.fetchUnstakedPositions(walletAddress),
        Position.fetchStakedPositions(walletAddress)
      ]);

      // Combine and return all positions
      return [...unstakedPositions, ...stakedPositions];
    } catch (error) {
      console.error('Error fetching positions:', error);
      return [];
    }
  }

  /**
   * Fetch unstaked positions for a wallet
   * @param {string} walletAddress - Wallet address
   * @returns {Promise<Array<Position>>} Array of Position instances
   */
  static async fetchUnstakedPositions(walletAddress) {
    try {
      const positionManagerContract = Position.getPositionManagerContract();

      // Get balance of position NFTs
      const balance = await positionManagerContract.read.balanceOf([walletAddress]);

      if (balance === 0n) {
        return [];
      }

      // Fetch all positions
      const positions = [];
      for (let i = 0; i < Number(balance); i++) {
        const tokenId = await positionManagerContract.read.tokenOfOwnerByIndex([walletAddress, BigInt(i)]);
        const positionData = await Position.fetchPositionDetails(tokenId, false, walletAddress);

        // Skip positions with 0 liquidity
        if (positionData.liquidity && positionData.liquidity > 0n) {
          // Calculate combined value in terms of token1 (stablecoin)
          const combinedToken1Value = await Position.calculateCombinedToken1Value(positionData);

          // Only include positions with combined value >= 0.1 token1
          if (combinedToken1Value >= 0.1) {
            positions.push(new Position(positionData));
          }
        }
      }

      return positions;
    } catch (error) {
      console.error('Error fetching unstaked positions:', error);
      return [];
    }
  }

  /**
   * Fetch staked positions for a wallet
   * @param {string} walletAddress - Wallet address
   * @returns {Promise<Array<Position>>} Array of Position instances
   */
  static async fetchStakedPositions(walletAddress) {
    try {
      const stakingContract = Position.getStakingContract();

      if (!stakingContract) {
        console.warn('Staking contract not available');
        return [];
      }

      // Get balance of staked positions
      const balance = await stakingContract.read.balanceOf([walletAddress]);

      if (balance === 0n) {
        return [];
      }

      const stakedPositions = [];

      // Iterate through staked positions
      for (let i = 0; i < Number(balance); i++) {
        try {
          // Get the token ID from the staking contract
          const tokenId = await stakingContract.read.tokenOfOwnerByIndex([walletAddress, BigInt(i)]);

          // Get position details
          const positionData = await Position.fetchPositionDetails(tokenId, true, walletAddress);

          // Skip positions with 0 liquidity
          if (positionData.liquidity && positionData.liquidity > 0n) {
            // Calculate combined value in terms of token1 (stablecoin)
            const combinedToken1Value = await Position.calculateCombinedToken1Value(positionData);

            // Only include positions with combined value >= 0.1 token1
            if (combinedToken1Value >= 0.1) {
              stakedPositions.push(new Position(positionData));
            }
          }
        } catch (error) {
          console.error(`Error processing staked position at index ${i}:`, error);
        }
      }

      return stakedPositions;
    } catch (error) {
      console.error('Error fetching staked positions:', error);
      return [];
    }
  }

  /**
   * Fetch position details from blockchain
   * @param {bigint} tokenId - Token ID
   * @param {boolean} isStaked - Whether position is staked
   * @param {string} walletAddress - Wallet address
   * @returns {Promise<Object>} Position details
   */
  static async fetchPositionDetails(tokenId, isStaked = false, walletAddress = null) {
    try {
      const positionManagerContract = Position.getPositionManagerContract();
      const positionData = await positionManagerContract.read.positions([tokenId]);

      const token0Address = positionData[2];
      const token1Address = positionData[3];
      const fee = positionData[4];
      const tickLower = positionData[5];
      const tickUpper = positionData[6];
      const liquidity = positionData[7];

      // Get Uniswap SDK Token instances
      const tokenService = Position.getTokenService();
      const [token0, token1] = await Promise.all([
        tokenService.getToken(token0Address),
        tokenService.getToken(token1Address)
      ]);

      // Get pool data
      const poolData = await Position.getPoolData(token0Address, token1Address, fee);

      let tokenAmounts = { amount0: '0', amount1: '0' };
      let currentTick = 0;

      if (poolData.address && poolData.sqrtPriceX96) {
        currentTick = poolData.tick;

        // Use SDK for precise calculations
        tokenAmounts = await Position.calculateTokenAmounts(
            liquidity,
            Number(tickLower),
            Number(tickUpper),
            currentTick,
            token0,
            token1,
            Number(fee),
            poolData.sqrtPriceX96
        );
      }

      const lowerPrice = tickToHumanPrice(Number(tickLower), token0, token1);
      const upperPrice = tickToHumanPrice(Number(tickUpper), token0, token1);
      const currentPrice = tickToHumanPrice(currentTick, token0, token1);
      const inRange = isPositionInRange(Number(tickLower), Number(tickUpper), currentTick);

      return {
        tokenId,
        token0: token0Address,
        token1: token1Address,
        token0Symbol: token0.symbol,
        token1Symbol: token1.symbol,
        token0Decimals: token0.decimals,
        token1Decimals: token1.decimals,
        fee,
        tickLower,
        tickUpper,
        currentTick,
        liquidity,
        token0Amount: tokenAmounts.amount0,
        token1Amount: tokenAmounts.amount1,
        lowerPrice,
        upperPrice,
        currentPrice,
        inRange,
        isStaked,
        token0Instance: token0,
        token1Instance: token1,
        walletAddress,
        poolAddress: poolData.address
      };
    } catch (error) {
      console.error(`Error getting position details for token ID ${tokenId}:`, error);
      return { tokenId, error: 'Failed to fetch position details', isStaked, walletAddress };
    }
  }

  /**
   * Calculate combined token1 value for a position
   * @param {Object} positionData - Position data
   * @returns {Promise<number>} Combined value in token1 units
   */
  static async calculateCombinedToken1Value(positionData) {
    try {
      // Get token1 amount (already in stablecoin)
      const token1Amount = parseFloat(positionData.token1Amount);

      // Convert token0 amount to token1 equivalent using current price
      const token0AmountInToken1 = parseFloat(positionData.token0Amount) * parseFloat(positionData.currentPrice);

      // Return combined value
      return token1Amount + token0AmountInToken1;
    } catch (error) {
      console.error('Error calculating combined token1 value:', error);
      return 0;
    }
  }

  /**
   * Calculate token amounts using Uniswap SDK
   * @param {bigint} liquidity - Position liquidity
   * @param {number} tickLower - Lower tick
   * @param {number} tickUpper - Upper tick
   * @param {number} tickCurrent - Current tick
   * @param {Token} token0 - Token0 instance
   * @param {Token} token1 - Token1 instance
   * @param {number} feeTier - Pool fee tier
   * @param {bigint} sqrtPriceX96 - Square root price
   * @returns {Object} Calculated amounts
   */
  static async calculateTokenAmounts(liquidity, tickLower, tickUpper, tickCurrent, token0, token1, feeTier, sqrtPriceX96) {
    try {
      const pool = new Pool(
          token0,
          token1,
          feeTier,
          sqrtPriceX96.toString(),
          liquidity.toString(),
          tickCurrent
      );

      const position = new UniswapPosition({
        pool,
        liquidity: liquidity.toString(),
        tickLower,
        tickUpper
      });

      return {
        amount0: position.amount0.toFixed(token0.decimals),
        amount1: position.amount1.toFixed(token1.decimals),
      };
    } catch (error) {
      console.error('Error calculating token amounts with SDK:', error);
      return { amount0: '0', amount1: '0' };
    }
  }

  /**
   * Get pool data from factory
   * @param {string} token0Address - Token0 address
   * @param {string} token1Address - Token1 address
   * @param {number} fee - Pool fee
   * @returns {Promise<Object>} Pool data
   */
  static async getPoolData(token0Address, token1Address, fee) {
    try {
      const positionManagerContract = Position.getPositionManagerContract();
      const factoryAddress = await positionManagerContract.read.factory();
      const factoryAbi = require('./abis/v3-factory.json');

      const factoryContract = getContract({
        address: factoryAddress,
        abi: factoryAbi,
        client: Position.getProvider()
      });

      const poolAddress = await factoryContract.read.getPool([token0Address, token1Address, fee]);

      if (poolAddress && poolAddress !== '0x0000000000000000000000000000000000000000') {
        const poolAbi = require('./abis/v3-pool.json');
        const poolContract = getContract({
          address: poolAddress,
          abi: poolAbi,
          client: Position.getProvider()
        });

        const slot0 = await poolContract.read.slot0();

        return {
          address: poolAddress,
          sqrtPriceX96: slot0[0],
          tick: Number(slot0[1]),
          contract: poolContract
        };
      }

      return { address: null, sqrtPriceX96: null, tick: 0 };
    } catch (error) {
      console.error('Error getting pool data:', error);
      return { address: null, sqrtPriceX96: null, tick: 0 };
    }
  }

  /**
   * Refresh position data from blockchain
   * @returns {Promise<void>}
   */
  async refresh() {
    try {
      const updatedData = await Position.fetchPositionDetails(this.tokenId, this.isStaked, this.walletAddress);

      if (updatedData.error) {
        throw new Error(updatedData.error);
      }

      // Update instance properties
      Object.assign(this, updatedData);
    } catch (error) {
      console.error(`Error refreshing position ${this.tokenId}:`, error);
      throw error;
    }
  }

  /**
   * Get combined token1 value for this position
   * @returns {Promise<number>} Combined value in token1 units
   */
  async getCombinedToken1Value() {
    return await Position.calculateCombinedToken1Value(this);
  }

  /**
   * Check if position is in range
   * @returns {boolean} True if position is in range
   */
  isInRange() {
    return this.inRange;
  }

  /**
   * Get position pool address
   * @returns {string} Pool address
   */
  getPoolAddress() {
    return this.poolAddress;
  }

  /**
   * Convert position to plain object
   * @returns {Object} Position as plain object
   */
  toObject() {
    return {
      tokenId: this.tokenId,
      token0: this.token0,
      token1: this.token1,
      token0Symbol: this.token0Symbol,
      token1Symbol: this.token1Symbol,
      token0Decimals: this.token0Decimals,
      token1Decimals: this.token1Decimals,
      fee: this.fee,
      tickLower: this.tickLower,
      tickUpper: this.tickUpper,
      currentTick: this.currentTick,
      liquidity: this.liquidity,
      token0Amount: this.token0Amount,
      token1Amount: this.token1Amount,
      lowerPrice: this.lowerPrice,
      upperPrice: this.upperPrice,
      currentPrice: this.currentPrice,
      inRange: this.inRange,
      isStaked: this.isStaked,
      walletAddress: this.walletAddress,
      poolAddress: this.poolAddress
    };
  }
}

module.exports = Position;

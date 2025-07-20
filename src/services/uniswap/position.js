const { getContract } = require('viem');
const { contracts } = require('../../config');
const { Token } = require('@uniswap/sdk-core');
const {EventEmitter} = require('events');
const { getPool, Pool} = require('./pool');
const { tickToHumanPrice, isPositionInRange } = require('./helpers');
const TokenService = require('./token');
const { getProvider } = require('../blockchain/provider');
const { Position: UniswapPosition, Pool: UniswapPool } = require('@uniswap/v3-sdk');
const { mongoose } = require("../database/mongoose");

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
    this.walletAddress = positionData.walletAddress;

    this.pool = getPool(positionData.poolAddress, provider);

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
   * Fetch all positions for a wallet
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
   * @param {string|null} walletAddress - Wallet address
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
      const pool = await Pool.getPoolOfTokens(token0Address, token1Address, fee);
      await pool.getPoolInfo();
      // FIXME hide this complexity - info must NOT come from cache, must be fresh
      const slot0 = (await pool.contract.read.slot0());
      const sqrtPriceX96 = slot0[0];
      const currentTick = slot0[1];

      const tokenAmounts = await Position.calculateTokenAmounts(
          liquidity,
          tickLower,
          tickUpper,
          currentTick,
          token0,
          token1,
          Number(fee),
          sqrtPriceX96
        );

      const lowerPrice = tickToHumanPrice(Number(tickLower), token0, token1);
      const upperPrice = tickToHumanPrice(Number(tickUpper), token0, token1);
      const currentPrice = tickToHumanPrice(currentTick, token0, token1);
      const inRange = isPositionInRange(Number(tickLower), Number(tickUpper), currentTick);

      return {
        tokenId,
        token0: token0,
        token1: token1,
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
        walletAddress,
        poolAddress: pool.address,
        pool
      };
    } catch (error) {
      console.error(`Error getting position details for token ID ${tokenId}:`, error);
      return { tokenId, error: 'Failed to fetch position details', isStaked, walletAddress };
    }
  }

  /**
   * Fetch accumulated fees for a position
   * @returns {Promise<Object>} Accumulated fees
   */
  async fetchAccumulatedFees() {
    try {
      if (this.liquidity === 0n) {
        return {
          token0Fees: '0',
          token1Fees: '0',
          token0Symbol: '',
          token1Symbol: '',
          totalValue: 0
        };
      }

      const positionManagerContract = Position.getPositionManagerContract();

      // Prepare collect call with max values to simulate fee collection without actually collecting
      const collectParams = {
        tokenId: this.tokenId,
        recipient: '0x0000000000000000000000000000000000000000', // Zero address for simulation
        amount0Max: BigInt('340282366920938463463374607431768211455'), // Max uint128
        amount1Max: BigInt('340282366920938463463374607431768211455')  // Max uint128
      };

      // Simulate the collect call to get fees without actually collecting them
      const feeAmounts = await positionManagerContract.simulate.collect([collectParams]);
      const amount0Fees = feeAmounts.result[0];
      const amount1Fees = feeAmounts.result[1];

      // Convert to human readable amounts
      const token0FeesFormatted = (parseFloat(amount0Fees.toString()) / Math.pow(10, this.token0.decimals)).toFixed(this.token0.decimals);
      const token1FeesFormatted = (parseFloat(amount1Fees.toString()) / Math.pow(10, this.token1.decimals)).toFixed(this.token1.decimals);

      // Calculate total value assuming token1 is stablecoin (like USDC)
      const token0Value = parseFloat(token0FeesFormatted) * (this.currentPrice || 0);
      const token1Value = parseFloat(token1FeesFormatted);
      let totalValue = token0Value + token1Value;

      // Add CAKE rewards if position is staked
      let cakeRewards = null;
      try {
        const cakeRewardAmount = await this.fetchCakeRewards();
        if (cakeRewardAmount > 0) {
          const cakePrice = await Position.getCakePrice();
          const cakeValue = cakeRewardAmount * cakePrice;
          cakeRewards = {
            amount: cakeRewardAmount.toFixed(4),
            value: cakeValue,
            price: cakePrice
          };
        }
      } catch (error) {
        console.warn(`Could not fetch CAKE rewards for position ${this.tokenId}:`, error.message);
      }

      return {
        token0Fees: token0FeesFormatted,
        token1Fees: token1FeesFormatted,
        token0Symbol: this.token0.symbol,
        token1Symbol: this.token1.symbol,
        token0Value,
        token1Value,
        totalValue,
        currentPrice: this.currentPrice,
        cakeRewards
      };
    } catch (error) {
      console.error(`Error fetching accumulated fees for token ID ${this.tokenId}:`, error);
      return {
        token0Fees: '0',
        token1Fees: '0',
        token0Symbol: '',
        token1Symbol: '',
        totalValue: 0,
        error: error.message
      };
    }
  }

  /**
   * Fetch CAKE rewards for a staked position
   * @returns {Promise<number>} CAKE reward amount
   */
  async fetchCakeRewards() {
    try {
      const stakingContract = Position.getStakingContract();
      if (!stakingContract) {
        throw new Error('Staking contract not available');
      }

      if (!this.isStaked) {
        return 0; // No rewards for unstaked positions
      }

      // Get pending CAKE rewards from staking contract
      const pendingCake = await stakingContract.read.pendingCake([this.tokenId]);

      if (!pendingCake || pendingCake === 0n) return 0;

      // Convert to human readable amount (CAKE has 18 decimals)
      return parseFloat(pendingCake.toString()) / Math.pow(10, 18);

    } catch (error) {
      console.error(`Error fetching CAKE rewards for position ${this.tokenId}:`, error);
      return 0;
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
      const pool = new UniswapPool(
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
    return this.pool.address;
  }

  /**
   * Convert position to plain object
   * @returns {Object} Position as plain object
   */
  toObject() {
    return {
      tokenId: this.tokenId,
      token0: this.token0.address,
      token1: this.token1.address,
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
      poolAddress: this.getPoolAddress()
    };
  }

  /**
   * Get current CAKE price in USD from CAKE/USDT pool
   * @returns {Promise<number>} CAKE price in USD
   */
  static async getCakePrice() {
    try {
      const { Pool } = require('./pool');

      // Find CAKE pools
      const cakePools = await mongoose.findPoolsByTokenSymbol('Cake');

      if (cakePools.length === 0) {
        throw new Error('No CAKE pools found in database');
      }

      // Find a CAKE/USDT or CAKE/USDC pool
      const cakeStablePool = cakePools.find(pool => {
        const token0Symbol = pool.token0.symbol;
        const token1Symbol = pool.token1.symbol;
        return (token0Symbol === 'Cake' && (token1Symbol === 'USDT' || token1Symbol === 'USDC')) ||
               ((token0Symbol === 'USDT' || token0Symbol === 'USDC') && token1Symbol === 'Cake');
      });

      if (!cakeStablePool) {
        throw new Error('No CAKE/USDT or CAKE/USDC pool found');
      }

      // Get the pool instance
      const pool = Pool.getPool(cakeStablePool.address);

      // Get current price from the pool
      return await pool.getCurrentPrice();
    } catch (error) {
      console.error('Error fetching CAKE price from pool:', error);
      return 0; // Fallback price
    }
  }
}

module.exports = Position;

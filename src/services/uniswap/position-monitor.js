const { getContract } = require('viem');
const { contracts } = require('../../config');
const { Pool, Position } = require('@uniswap/v3-sdk');
const { Token } = require('@uniswap/sdk-core');

const { getTimeInTimezone } = require('../../utils/time');
const { tickToHumanPrice, isPositionInRange } = require('./helpers');
const TokenService = require('./token');

class PositionMonitor {
  /**
   * Create a new position monitor
   * @param {object} provider - Blockchain provider
   * @param {object} mongoStateManager - MongoDB state manager instance
   */
  constructor(provider, mongoStateManager) {
    this.provider = provider;
    this.mongoStateManager = mongoStateManager;
    this.tokenService = new TokenService(provider);
    this.monitoredWallets = new Map(); // wallet -> { chatId, lastCheck, lastPositions }
    this.positionManagerAddress = contracts.getContractAddress('pancakeswap', 'arbitrum', 'nonfungiblePositionManager');
    this.positionManagerContract = this.createPositionManagerContract();

    // Add staking contract support
    this.stakingContractAddress = contracts.getContractAddress('pancakeswap', 'arbitrum', 'masterChefV3');
    this.stakingContract = this.createStakingContract();

    // Load monitored wallets from MongoDB on initialization
    this.loadMonitoredWalletsFromDB();
  }

  /**
   * Create the position manager contract instance
   * @returns {object} Contract instance
   */
  createPositionManagerContract() {
    const positionManagerAbi = require('./abis/v3-position-manager.json');
    return getContract({
      address: this.positionManagerAddress,
      abi: positionManagerAbi,
      client: this.provider
    });
  }

  /**
   * Create the staking contract instance
   * @returns {object} Contract instance
   */
  createStakingContract() {
    try {
      const stakingAbi = require('./abis/masterchef-v3.json');
      return getContract({
        address: this.stakingContractAddress,
        abi: stakingAbi,
        client: this.provider
      });
    } catch (error) {
      console.warn('Staking contract not available:', error.message);
      return null;
    }
  }

  /**
   * Fetch all positions for a wallet (including staked positions)
   * @param {string} walletAddress - Wallet address
   * @returns {Promise<Array>} Positions array
   */
  async getPositions(walletAddress) {
    try {
      // Get both unstaked and staked positions
      const [unstakedPositions, stakedPositions] = await Promise.all([
        this.getUnstakedPositions(walletAddress),
        this.getStakedPositions(walletAddress)
      ]);

      // Combine and return all positions
      return [...unstakedPositions, ...stakedPositions];
    } catch (error) {
      console.error('Error fetching positions:', error);
      return [];
    }
  }

  /**
   * Fetch unstaked positions (original implementation)
   * @param {string} walletAddress - Wallet address
   * @returns {Promise<Array>} Positions array
   */
  async getUnstakedPositions(walletAddress) {
    try {
      // Get balance of position NFTs
      const balance = await this.positionManagerContract.read.balanceOf([walletAddress]);

      if (balance === 0n) {
        return [];
      }

      // Fetch all positions
      const positions = [];
      for (let i = 0; i < Number(balance); i++) {
        const tokenId = await this.positionManagerContract.read.tokenOfOwnerByIndex([walletAddress, BigInt(i)]);
        const position = await this.getPositionDetails(tokenId, false); // false = not staked

        // Skip positions with 0 liquidity
        if (position.liquidity && position.liquidity > 0n) {
          // Calculate combined value in terms of token1 (stablecoin)
          const combinedToken1Value = await this.calculateCombinedToken1Value(position);

          // Only include positions with combined value >= 0.1 token1
          if (combinedToken1Value >= 0.1) {
            positions.push(position);
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
   * Fetch staked positions from MasterChef V3
   * @param {string} walletAddress - Wallet address
   * @returns {Promise<Array>} Staked positions array
   */
  async getStakedPositions(walletAddress) {
    try {
      if (!this.stakingContract) {
        console.warn('Staking contract not available');
        return [];
      }

      // Get balance of staked positions using balanceOf from the staking contract
      const balance = await this.stakingContract.read.balanceOf([walletAddress]);

      if (balance === 0n) {
        return [];
      }

      const stakedPositions = [];

      // Iterate through staked positions using tokenOfOwnerByIndex
      for (let i = 0; i < Number(balance); i++) {
        try {
          // Get the token ID from the staking contract
          const tokenId = await this.stakingContract.read.tokenOfOwnerByIndex([walletAddress, BigInt(i)]);

          // Get position details from the position manager
          const position = await this.getPositionDetails(tokenId, true); // true = staked

          // Skip positions with 0 liquidity
          if (position.liquidity && position.liquidity > 0n) {
            // Calculate combined value in terms of token1 (stablecoin)
            const combinedToken1Value = await this.calculateCombinedToken1Value(position);

            // Only include positions with combined value >= 0.1 token1
            if (combinedToken1Value >= 0.1) {
              stakedPositions.push(position);
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
   * Calculate the combined value of a position in terms of token1 (stablecoin)
   * @param {Object} position - Position object
   * @returns {Promise<number>} Combined value in token1 units
   */
  async calculateCombinedToken1Value(position) {
    try {
      // Get token1 amount (already in stablecoin)
      const token1Amount = parseFloat(position.token1Amount);

      // Convert token0 amount to token1 equivalent using current price
      const token0AmountInToken1 = parseFloat(position.token0Amount) * parseFloat(position.currentPrice);

      // Return combined value
      return token1Amount + token0AmountInToken1;
    } catch (error) {
      console.error('Error calculating combined token1 value:', error);
      return 0; // Return 0 to filter out positions with errors
    }
  }

  /**
   * Get token using Uniswap SDK Token class
   * @param {string} tokenAddress - Token address
   * @returns {Promise<Token>} Uniswap SDK Token instance
   */
  async getToken(tokenAddress) {
    return await this.tokenService.getToken(tokenAddress);
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
   * @param sqrtPriceX96
   * @returns {Object} Calculated amounts
   */
  async calculateTokenAmounts(liquidity, tickLower, tickUpper, tickCurrent, token0, token1, feeTier, sqrtPriceX96) {
    try {
      const pool = new Pool(
        token0,
        token1,
        feeTier,
        sqrtPriceX96.toString(),
        liquidity.toString(),
        tickCurrent
      );

      const position = new Position({
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
      return { amount0: '0', amount1: '0', amount0Raw: '0', amount1Raw: '0' };
    }
  }

  /**
   * Get position details including staking status
   * @param {bigint} tokenId - Token ID
   * @param {boolean} isStaked - Whether position is staked
   * @returns {Promise<Object>} Position details
   */
  async getPositionDetails(tokenId, isStaked = false) {
    try {
      const positionData = await this.positionManagerContract.read.positions([tokenId]);

      const token0Address = positionData[2];
      const token1Address = positionData[3];
      const fee = positionData[4];
      const tickLower = positionData[5];
      const tickUpper = positionData[6];
      const liquidity = positionData[7];

      // Get Uniswap SDK Token instances
      const [token0, token1] = await Promise.all([
        this.getToken(token0Address),
        this.getToken(token1Address)
      ]);

      // Get pool data
      const poolData = await this.getPoolData(token0Address, token1Address, fee);

      let tokenAmounts = { amount0: '0', amount1: '0' };
      let currentTick = 0;

      if (poolData.address && poolData.sqrtPriceX96) {
        currentTick = poolData.tick;

        // Use SDK for precise calculations
        tokenAmounts = await this.calculateTokenAmounts(
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
        isStaked, // Add staking status
        // Add SDK token instances for advanced operations
        token0Instance: token0,
        token1Instance: token1
      };
    } catch (error) {
      console.error(`Error getting position details for token ID ${tokenId}:`, error);
      return { tokenId, error: 'Failed to fetch position details', isStaked };
    }
  }

  /**
   * Get pool data from factory
   * @param {string} token0Address - Token0 address
   * @param {string} token1Address - Token1 address
   * @param {number} fee - Pool fee
   * @returns {Promise<Object>} Pool data
   */
  async getPoolData(token0Address, token1Address, fee) {
    try {
      const factoryAddress = await this.positionManagerContract.read.factory();
      const factoryAbi = [
        {
          inputs: [
            { internalType: 'address', name: 'tokenA', type: 'address' },
            { internalType: 'address', name: 'tokenB', type: 'address' },
            { internalType: 'uint24', name: 'fee', type: 'uint24' }
          ],
          name: 'getPool',
          outputs: [{ internalType: 'address', name: '', type: 'address' }],
          stateMutability: 'view',
          type: 'function'
        }
      ];

      const factoryContract = getContract({
        address: factoryAddress,
        abi: factoryAbi,
        client: this.provider
      });

      const poolAddress = await factoryContract.read.getPool([token0Address, token1Address, fee]);

      if (poolAddress && poolAddress !== '0x0000000000000000000000000000000000000000') {
        const poolAbi = require('./abis/v3-pool.json');
        const poolContract = getContract({
          address: poolAddress,
          abi: poolAbi,
          client: this.provider
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
   * Format a single position message according to the unified format
   * @param {Object} position - Position object
   * @param {string} timezone - User timezone
   * @param {boolean} isUpdate - Whether this is an update message (includes "Updated:" timestamp)
   * @returns {string} Formatted position message
   */
  formatSinglePositionMessage(position, timezone = 'UTC', isUpdate = false) {
    if (!position || position.error) {
      return `❌ Error loading position: ${position?.error || 'Unknown error'}`;
    }

    // Format fee percentage
    const feePercent = (position.fee / 10000).toFixed(2);

    // Create pool link (PancakeSwap format)
    const poolLink = `https://pancakeswap.finance/liquidity/${position.tokenId}?chain=arb&persistChain=1`;

    // Format token pair with link
    const tokenPairLine = `**${position.token0Symbol}/${position.token1Symbol}** (${feePercent}%) - [#${position.tokenId}](${poolLink})`;

    // Format token amounts
    const amountsLine = `💰 ${parseFloat(position.token0Amount).toFixed(4)} ${position.token0Symbol} + ${parseFloat(position.token1Amount).toFixed(2)} ${position.token1Symbol}`;

    // Format price and range
    const priceRangeLine = `📊 **$${parseFloat(position.currentPrice).toFixed(2)}** - $${parseFloat(position.lowerPrice).toFixed(2)} - $${parseFloat(position.upperPrice).toFixed(2)}`;

    // Format status
    const stakingStatus = position.isStaked ? '🥩 STAKED' : '💼 UNSTAKED';
    const rangeStatus = position.inRange ? '🟢 IN RANGE' : '🔴 OUT OF RANGE';
    const statusLine = `${stakingStatus} | ${rangeStatus}`;

    // Build the message
    let message = `${tokenPairLine}\n${amountsLine}\n${priceRangeLine}\n${statusLine}`;

    // Add timestamp if this is an update
    if (isUpdate) {
      message += `\n🕐 Updated: ${getTimeInTimezone(timezone)}`;
    }

    return message;
  }

  /**
   * Load monitored wallets from MongoDB
   */
  async loadMonitoredWalletsFromDB() {
    try {
      const wallets = await this.mongoStateManager.loadMonitoredWallets();
      for (const wallet of wallets) {
        this.monitoredWallets.set(wallet.walletAddress, {
          chatId: wallet.chatId,
          lastCheck: wallet.lastCheck || new Date(),
          lastPositions: [] // Reset positions on startup - they'll be fetched fresh
        });
      }
      console.log(`Loaded ${wallets.length} monitored wallets from database`);
    } catch (error) {
      console.error('Error loading monitored wallets from database:', error);
    }
  }

  /**
   * Save monitored wallets to MongoDB
   */
  async saveMonitoredWalletsToDB() {
    try {
      await this.mongoStateManager.saveMonitoredWallets(this.monitoredWallets);
    } catch (error) {
      console.error('Error saving monitored wallets to database:', error);
    }
  }

  /**
   * Start monitoring a wallet
   * @param {string} walletAddress - Wallet address to monitor
   * @param {number} chatId - Telegram chat ID
   */
  startMonitoring(walletAddress, chatId) {
    const key = walletAddress.toLowerCase();
    this.monitoredWallets.set(key, {
      chatId,
      lastCheck: new Date(),
      lastPositions: []
    });

    // Save to database
    this.saveMonitoredWalletsToDB();
  }

  /**
   * Stop monitoring a wallet
   * @param {string} walletAddress - Wallet address to stop monitoring
   * @returns {boolean} True if wallet was being monitored
   */
  stopMonitoring(walletAddress) {
    const key = walletAddress.toLowerCase();
    const wasMonitored = this.monitoredWallets.delete(key);

    if (wasMonitored) {
      // Save to database
      this.saveMonitoredWalletsToDB();
    }

    return wasMonitored;
  }

  /**
   * Get list of monitored wallets
   * @returns {Array} Array of monitored wallet addresses
   */
  getMonitoredWallets() {
    return Array.from(this.monitoredWallets.keys());
  }

  /**
   * Get pool address for a position
   * @param {Object} position - Position object
   * @returns {Promise<string>} Pool address
   */
  async getPoolAddressForPosition(position) {
    try {
      const poolData = await this.getPoolData(position.token0, position.token1, position.fee);
      return poolData.address || '';
    } catch (error) {
      console.error('Error getting pool address for position:', error);
      return '';
    }
  }
}

module.exports = PositionMonitor;

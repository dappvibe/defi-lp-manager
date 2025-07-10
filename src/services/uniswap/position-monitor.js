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
    this.monitoredWallets = new Map(); // wallet -> { chatId, lastCheck }
    this.positionManagerAddress = contracts.getContractAddress('pancakeswap', 'arbitrum', 'nonfungiblePositionManager');
    this.positionManagerContract = this.createPositionManagerContract();
    this.erc20Abi = require('./abis/erc20.json');
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
   * Check if a position is active in the current price range
   * @param {number} tickLower - Lower tick boundary
   * @param {number} tickUpper - Upper tick boundary
   * @param {number} tickCurrent - Current pool tick
   * @returns {boolean} True if position is in range
   */
  isPositionInRange(tickLower, tickUpper, tickCurrent) {
    return isPositionInRange(tickLower, tickUpper, tickCurrent);
  }

  /**
   * Get token symbol and decimals
   * @param {string} tokenAddress - Token address
   * @returns {Promise<{symbol: string, decimals: number}>} Token info
   */
  async getTokenInfo(tokenAddress) {
    try {
      const tokenContract = getContract({
        address: tokenAddress,
        abi: this.erc20Abi,
        client: this.provider
      });

      const [symbol, decimals] = await Promise.all([
        tokenContract.read.symbol(),
        tokenContract.read.decimals()
      ]);

      return { symbol, decimals };
    } catch (error) {
      console.error(`Error getting token info for ${tokenAddress}:`, error);
      return { symbol: 'UNKNOWN', decimals: 18 };
    }
  }

  /**
   * Fetch all positions for a wallet
   * @param {string} walletAddress - Wallet address
   * @returns {Promise<Array>} Positions array
   */
  async getPositions(walletAddress) {
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
        const position = await this.getPositionDetails(tokenId);

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
      console.error('Error fetching positions:', error);
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

  async getPositionDetails(tokenId) {
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
        // Add SDK token instances for advanced operations
        token0Instance: token0,
        token1Instance: token1
      };
    } catch (error) {
      console.error(`Error getting position details for token ID ${tokenId}:`, error);
      return { tokenId, error: 'Failed to fetch position details' };
    }
  }

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
   * Format positions for display in Telegram
   * @param {Array} positions - Position array
   * @param {string} timezone - User's timezone
   * @returns {string} Formatted message
   */
  formatPositionsMessage(positions, timezone) {
    if (positions.length === 0) {
      return "No active positions found for this wallet address.";
    }

    let message = ` ${positions.length} active position(s) found:\n\n`;

    positions.forEach((position, index) => {
      if (position.error) {
        message += `Position #${index + 1}: Error - ${position.error}\n\n`;
        return;
      }

      message += ` Position #${index + 1}\n`;
      message += `ID: ${position.tokenId}\n`;
      message += `Pair: ${position.token0Symbol}/${position.token1Symbol}\n`;
      message += `Fee: ${Number(position.fee) / 10000}%\n`;

      // Add token amounts
      message += `Liquidity in tokens:\n`;
      message += `- ${position.token0Amount} ${position.token0Symbol}\n`;
      message += `- ${position.token1Amount} ${position.token1Symbol}\n`;

      // Add human-readable price ranges
      message += `Price range (${position.token1Symbol} per ${position.token0Symbol}):\n`;
      message += `- Min: ${position.lowerPrice}\n`;
      message += `- Max: ${position.upperPrice}\n`;
      message += `- Current: ${position.currentPrice}\n`;

      // Show if position is in range
      const rangeStatus = position.inRange ? '🟢 In range' : '🔴 Out of range';
      message += `Status: ${rangeStatus}\n`;

      // Add raw liquidity and ticks for reference
      message += `Raw liquidity: ${position.liquidity.toString()}\n`;
      message += `Ticks: [${position.tickLower} to ${position.tickUpper}]\n\n`;
    });

    // Add timestamp
    message += `\nLast updated: ${getTimeInTimezone(timezone)}`;

    return message;
  }

  /**
   * Start database a wallet for position changes
   * @param {string} walletAddress - Wallet address to monitor
   * @param {number} chatId - Telegram chat ID
   * @returns {boolean} Success status
   */
  async startMonitoring(walletAddress, chatId) {
    // Normalize address
    const normalizedAddress = walletAddress.toLowerCase();

    // Check if already database
    if (this.monitoredWallets.has(normalizedAddress)) {
      const info = this.monitoredWallets.get(normalizedAddress);

      // Update the chat ID if it's different
      if (info.chatId !== chatId) {
        info.chatId = chatId;
        this.monitoredWallets.set(normalizedAddress, info);
        await this.saveState();
      }

      return false; // Already database
    }

    // Start database
    this.monitoredWallets.set(normalizedAddress, {
      chatId,
      lastCheck: Date.now()
    });

    // Save to MongoDB
    await this.saveState();

    return true; // Started database
  }

  /**
   * Stop database a wallet
   * @param {string} walletAddress - Wallet address
   * @returns {boolean} Success status
   */
  async stopMonitoring(walletAddress) {
    const normalizedAddress = walletAddress.toLowerCase();
    const result = this.monitoredWallets.delete(normalizedAddress);

    if (result) {
      // Save updated state to MongoDB
      await this.saveState();
    }

    return result;
  }

  /**
   * Get list of monitored wallets
   * @returns {string[]} List of addresses
   */
  getMonitoredWallets() {
    return Array.from(this.monitoredWallets.keys());
  }

  /**
   * Check if a wallet is being monitored
   * @param {string} walletAddress - Wallet address
   * @returns {boolean} Is monitored
   */
  isMonitored(walletAddress) {
    const normalizedAddress = walletAddress.toLowerCase();
    return this.monitoredWallets.has(normalizedAddress);
  }

  /**
   * Save current state to MongoDB
   */
  async saveState() {
    if (this.mongoStateManager) {
      await this.mongoStateManager.saveMonitoredWallets(this.monitoredWallets);
    }
  }

  /**
   * Initialize the position monitor by restoring state from MongoDB
   */
  async initialize() {
    if (!this.mongoStateManager) {
      console.warn('MongoDB state manager not provided, cannot restore wallets');
      return;
    }

    try {
      // Load wallets from MongoDB
      const wallets = await this.mongoStateManager.loadMonitoredWallets();

      // Restore each wallet to the monitored map
      wallets.forEach(wallet => {
        this.monitoredWallets.set(wallet.walletAddress, {
          chatId: wallet.chatId,
          lastCheck: wallet.lastCheck || Date.now()
        });
      });

      console.log(`Restored ${wallets.length} monitored wallets from database`);
    } catch (error) {
      console.error('Error initializing position monitor:', error);
    }
  }
}

module.exports = PositionMonitor;

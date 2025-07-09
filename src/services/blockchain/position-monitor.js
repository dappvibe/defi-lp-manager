/**
 * Position Monitor Service
 * Monitors and manages V3 positions for wallet addresses
 */

const { getContract } = require('viem');
const { constants, contracts } = require('../../config');
const { formatUnits } = require('viem');
const { getTimeInTimezone } = require('../../utils/time');
const { Token, CurrencyAmount, Price } = require('@uniswap/sdk-core');
const { Position, Pool, nearestUsableTick, TickMath, SqrtPriceMath } = require('@uniswap/v3-sdk');
const JSBI = require('jsbi');

class PositionMonitor {
  /**
   * Create a new position monitor
   * @param {object} provider - Blockchain provider
   */
  constructor(provider) {
    this.provider = provider;
    this.monitoredWallets = new Map(); // wallet -> { chatId, lastCheck }
    this.positionManagerAddress = contracts.getContractAddress('pancakeswap', 'arbitrum', 'nonfungiblePositionManager');
    this.positionManagerContract = this.createPositionManagerContract();
    this.erc20Abi = require('../../../data/abis/erc20.json');
    this.chainId = 42161; // Arbitrum chain ID
  }

  /**
   * Create the position manager contract instance
   * @returns {object} Contract instance
   */
  createPositionManagerContract() {
    const positionManagerAbi = require('../../../data/abis/nonfungible-position-manager.json');
    return getContract({
      address: this.positionManagerAddress,
      abi: positionManagerAbi,
      client: this.provider
    });
  }

  /**
   * Get token symbol and decimals
   * @param {string} tokenAddress - Token address
   * @returns {Promise<{symbol: string, decimals: number}>} Token info
   */
  async getTokenInfo(tokenAddress) {
    console.log(`[PositionMonitor] Fetching token info for: ${tokenAddress}`);

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

      const result = { symbol, decimals };
      console.log(`[PositionMonitor] Token info for ${tokenAddress}:`, result);
      return result;
    } catch (error) {
      console.error(`[PositionMonitor] Error getting token info for ${tokenAddress}:`, error);
      const fallback = { symbol: 'UNKNOWN', decimals: 18 };
      console.log(`[PositionMonitor] Using fallback token info:`, fallback);
      return fallback;
    }
  }

  /**
   * Get pool data and calculate token amounts using Uniswap V3 SDK
   * @param {string} token0Address - Token0 address
   * @param {string} token1Address - Token1 address
   * @param {number} fee - Pool fee
   * @param {bigint} liquidity - Position liquidity
   * @param {number} tickLower - Lower tick
   * @param {number} tickUpper - Upper tick
   * @param {object} token0Info - Token0 info
   * @param {object} token1Info - Token1 info
   * @returns {Promise<{amount0: string, amount1: string, currentTick: number, inRange: boolean}>} Token amounts
   */
  async calculateTokenAmountsWithSDK(token0Address, token1Address, fee, liquidity, tickLower, tickUpper, token0Info, token1Info) {
    console.log(`[PositionMonitor] Calculating token amounts using SDK for pool ${token0Info.symbol}/${token1Info.symbol}`);

    try {
      // Get pool contract
      const poolFactoryAbi = require('../../../data/abis/pancakeswap-v3-factory.json');
      const poolAbi = require('../../../data/abis/pancakeswap-v3-pool.json');

      const factoryAddress = contracts.getContractAddress('pancakeswap', 'arbitrum', 'factory');
      const factoryContract = getContract({
        address: factoryAddress,
        abi: poolFactoryAbi,
        client: this.provider
      });

      // Get pool address
      const poolAddress = await factoryContract.read.getPool([token0Address, token1Address, fee]);

      if (poolAddress === '0x0000000000000000000000000000000000000000') {
        throw new Error('Pool not found');
      }

      console.log(`[PositionMonitor] Pool address: ${poolAddress}`);

      const poolContract = getContract({
        address: poolAddress,
        abi: poolAbi,
        client: this.provider
      });

      // Get current slot0 (contains current price and tick)
      const slot0 = await poolContract.read.slot0();
      const currentSqrtPriceX96 = slot0[0];
      const currentTick = Number(slot0[1]);

      console.log(`[PositionMonitor] Current tick: ${currentTick}, sqrt price: ${currentSqrtPriceX96.toString()}`);

      // Create Token instances
      const token0 = new Token(this.chainId, token0Address, token0Info.decimals, token0Info.symbol);
      const token1 = new Token(this.chainId, token1Address, token1Info.decimals, token1Info.symbol);

      // Create Pool instance
      const pool = new Pool(
        token0,
        token1,
        fee,
        currentSqrtPriceX96.toString(),
        liquidity.toString(),
        currentTick
      );

      // Create Position instance
      const position = new Position({
        pool: pool,
        liquidity: liquidity.toString(),
        tickLower: tickLower,
        tickUpper: tickUpper
      });

      // Get token amounts
      const amount0 = position.amount0;
      const amount1 = position.amount1;

      // Convert to human readable strings
      const readableAmount0 = amount0.toFixed(6);
      const readableAmount1 = amount1.toFixed(6);

      // Check if position is in range
      const inRange = currentTick >= tickLower && currentTick < tickUpper;

      console.log(`[PositionMonitor] Calculated amounts: ${readableAmount0} ${token0Info.symbol}, ${readableAmount1} ${token1Info.symbol}`);
      console.log(`[PositionMonitor] Position in range: ${inRange}`);

      return {
        amount0: readableAmount0,
        amount1: readableAmount1,
        currentTick: currentTick,
        inRange: inRange
      };
    } catch (error) {
      console.error(`[PositionMonitor] Error calculating token amounts:`, error);
      return {
        amount0: '0',
        amount1: '0',
        currentTick: 0,
        inRange: false
      };
    }
  }

  /**
   * Fetch all positions for a wallet
   * @param {string} walletAddress - Wallet address
   * @returns {Promise<Array>} Positions array
   */
  async osiogetPositions(walletAddress) {
    console.log(`[PositionMonitor] Starting position fetch for wallet: ${walletAddress}`);

    try {
      // Get balance of position NFTs
      console.log(`[PositionMonitor] Fetching NFT balance for wallet: ${walletAddress}`);
      const balance = await this.positionManagerContract.read.balanceOf([walletAddress]);
      console.log(`[PositionMonitor] NFT balance: ${balance.toString()}`);

      if (balance === 0n) {
        console.log(`[PositionMonitor] No NFTs found for wallet: ${walletAddress}`);
        return [];
      }

      // Fetch all positions
      const positions = [];
      console.log(`[PositionMonitor] Processing ${Number(balance)} NFT(s)`);

      for (let i = 0; i < Number(balance); i++) {
        console.log(`[PositionMonitor] Processing NFT ${i + 1}/${Number(balance)}`);

        try {
          const tokenId = await this.positionManagerContract.read.tokenOfOwnerByIndex([walletAddress, BigInt(i)]);
          console.log(`[PositionMonitor] Token ID ${i}: ${tokenId.toString()}`);

          const position = await this.getPositionDetails(tokenId);
          console.log(`[PositionMonitor] Position details for token ${tokenId}:`, {
            tokenId: tokenId.toString(),
            liquidity: position.liquidity?.toString() || 'undefined',
            token0Symbol: position.token0Symbol,
            token1Symbol: position.token1Symbol,
            hasError: !!position.error
          });

          // Skip positions with 0 liquidity
          if (position.liquidity && position.liquidity > 0n) {
            console.log(`[PositionMonitor] ✅ Including position ${tokenId} (liquidity: ${position.liquidity.toString()})`);
            positions.push(position);
          } else {
            console.log(`[PositionMonitor] ❌ Skipping position ${tokenId} (liquidity: ${position.liquidity?.toString() || 'undefined'})`);
          }
        } catch (tokenError) {
          console.error(`[PositionMonitor] Error processing token ${i}:`, tokenError);
        }
      }

      console.log(`[PositionMonitor] Final result: ${positions.length} positions with liquidity out of ${Number(balance)} total NFTs`);
      return positions;
    } catch (error) {
      console.error(`[PositionMonitor] Error fetching positions for ${walletAddress}:`, error);
      return [];
    }
  }

  /**
   * Get detailed information for a position
   * @param {bigint} tokenId - Position token ID
   * @returns {Promise<object>} Position details
   */
  async getPositionDetails(tokenId) {
    console.log(`[PositionMonitor] Fetching details for token ID: ${tokenId.toString()}`);

    try {
      const positionData = await this.positionManagerContract.read.positions([tokenId]);
      console.log(`[PositionMonitor] Raw position data for ${tokenId}:`, {
        length: positionData.length,
        liquidity: positionData[7]?.toString() || 'undefined'
      });

      // Extract position data
      const token0 = positionData[2];
      const token1 = positionData[3];
      const fee = positionData[4];
      const tickLower = positionData[5];
      const tickUpper = positionData[6];
      const liquidity = positionData[7];

      console.log(`[PositionMonitor] Parsed position data for ${tokenId}:`, {
        token0,
        token1,
        fee: fee?.toString(),
        tickLower: tickLower?.toString(),
        tickUpper: tickUpper?.toString(),
        liquidity: liquidity?.toString()
      });

      // Get token information
      console.log(`[PositionMonitor] Fetching token info for ${token0} and ${token1}`);
      const [token0Info, token1Info] = await Promise.all([
        this.getTokenInfo(token0),
        this.getTokenInfo(token1)
      ]);

      console.log(`[PositionMonitor] Token info for ${tokenId}:`, {
        token0Info,
        token1Info
      });

      // Calculate token amounts using SDK
      const tokenAmounts = await this.calculateTokenAmountsWithSDK(
        token0,
        token1,
        Number(fee),
        liquidity,
        Number(tickLower),
        Number(tickUpper),
        token0Info,
        token1Info
      );

      const result = {
        tokenId,
        token0,
        token1,
        token0Symbol: token0Info.symbol,
        token1Symbol: token1Info.symbol,
        token0Decimals: token0Info.decimals,
        token1Decimals: token1Info.decimals,
        fee,
        tickLower,
        tickUpper,
        liquidity,
        currentTick: tokenAmounts.currentTick,
        amount0: tokenAmounts.amount0,
        amount1: tokenAmounts.amount1,
        inRange: tokenAmounts.inRange
      };

      console.log(`[PositionMonitor] ✅ Successfully processed position ${tokenId}`);
      return result;
    } catch (error) {
      console.error(`[PositionMonitor] ❌ Error getting position details for token ID ${tokenId}:`, error);
      return {
        tokenId,
        error: 'Failed to fetch position details'
      };
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

    let message = `🔍 ${positions.length} active position(s) found:\n\n`;

    positions.forEach((position, index) => {
      if (position.error) {
        message += `Position #${index + 1}: Error - ${position.error}\n\n`;
        return;
      }

      // Format amounts with appropriate precision
      const amount0 = parseFloat(position.amount0).toFixed(6);
      const amount1 = parseFloat(position.amount1).toFixed(6);

      // Determine position status
      let priceStatus = '';
      if (position.currentTick < position.tickLower) {
        priceStatus = '📉 Below range (all in token0)';
      } else if (position.currentTick >= position.tickUpper) {
        priceStatus = '📈 Above range (all in token1)';
      } else {
        priceStatus = '🎯 In range (active)';
      }

      message += `💰 Position #${index + 1}\n`;
      message += `ID: ${position.tokenId}\n`;
      message += `Pair: ${position.token0Symbol}/${position.token1Symbol}\n`;
      message += `Fee: ${Number(position.fee) / 10000}%\n`;
      message += `\n💎 Liquidity:\n`;
      message += `• ${amount0} ${position.token0Symbol}\n`;
      message += `• ${amount1} ${position.token1Symbol}\n`;
      message += `\n📊 Status: ${priceStatus}\n`;
      message += `Range: [${position.tickLower} to ${position.tickUpper}]\n`;
      message += `Current: ${position.currentTick}\n\n`;
    });

    // Add timestamp
    message += `\n🕐 Last updated: ${getTimeInTimezone(timezone)}`;

    return message;
  }

  /**
   * Start monitoring a wallet for position changes
   * @param {string} walletAddress - Wallet address to monitor
   * @param {number} chatId - Telegram chat ID
   * @returns {boolean} Success status
   */
  startMonitoring(walletAddress, chatId) {
    // Normalize address
    const normalizedAddress = walletAddress.toLowerCase();

    // Check if already monitoring
    if (this.monitoredWallets.has(normalizedAddress)) {
      const info = this.monitoredWallets.get(normalizedAddress);

      // Update the chat ID if it's different
      if (info.chatId !== chatId) {
        info.chatId = chatId;
        this.monitoredWallets.set(normalizedAddress, info);
      }

      return false; // Already monitoring
    }

    // Start monitoring
    this.monitoredWallets.set(normalizedAddress, {
      chatId,
      lastCheck: Date.now()
    });

    return true; // Started monitoring
  }

  /**
   * Stop monitoring a wallet
   * @param {string} walletAddress - Wallet address
   * @returns {boolean} Success status
   */
  stopMonitoring(walletAddress) {
    const normalizedAddress = walletAddress.toLowerCase();
    return this.monitoredWallets.delete(normalizedAddress);
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
}

module.exports = PositionMonitor;

/**
 * Pool Service
 * Unified service for pool operations and monitoring
 * Provides a clean interface hiding MongoDB implementation details
 * Handles caching, retrieval, and real-time monitoring of pool information
 */
const { getTokenInfo, createPoolContract } = require('./contracts');
const { isValidEthereumAddress, calculatePrice } = require('./utils');
const { uniswapV3Pool: poolAbi } = require('./abis');
const { getTimeInTimezone } = require('../../utils/time');
const MongoStateManager = require('../database/mongo');
const poolsConfig = require('../../config/pools');
const { PositionMessage } = require('../telegram/commands/lp');

class PoolService {
  constructor() {
    this.stateManager = new MongoStateManager();
    // Monitoring-specific properties
    this.monitoredPools = {};
    this.watchUnsubscribers = {};
    this.autoSaveInterval = null;
  }

  /**
   * Initialize the pool service
   * @param {Object} botInstance - Telegram bot instance (optional, for monitoring)
   * @param {Object} providerInstance - Viem client instance (optional, for monitoring)
   * @param {string} timezone - Timezone for time display (optional, for monitoring)
   */
  async initialize(botInstance = null, providerInstance = null, timezone = null) {
    console.log('Initializing PoolService...');
    await this.stateManager.connect();

    // Cache pre-configured pools on startup
    await this._cachePreConfiguredPools();

    // Initialize monitoring if bot instance is provided
    if (botInstance && providerInstance && timezone) {
      await this._initializeMonitoring(botInstance, providerInstance, timezone);
    }
  }

  /**
   * Initialize monitoring functionality
   * @private
   * @param {Object} botInstance - Telegram bot instance
   * @param {Object} providerInstance - Viem client instance
   * @param {string} timezone - Timezone for time display
   */
  async _initializeMonitoring(botInstance, providerInstance, timezone) {
    console.log('Initializing monitoring functionality...');

    // Start auto-save interval (every 30 seconds)
    this._startAutoSave();

    // Load saved monitored pools state
    const savedState = await this.stateManager.loadAllPools();

    // Restore monitoring only for pools that have monitoring enabled
    for (const [poolAddress, poolData] of Object.entries(savedState)) {
      try {
        // Only restore monitoring for pools that have the monitoring flag enabled
        if (poolData.priceMonitoringEnabled === true) {
          await this.startMonitoring(
            botInstance,
            poolAddress,
            poolData,
            providerInstance,
            timezone
          );
          console.log(`Restored monitoring for pool: ${poolAddress}`);
        } else {
          console.log(`Skipping pool ${poolAddress} - monitoring disabled (priceMonitoringEnabled: ${poolData.priceMonitoringEnabled})`);
        }
      } catch (error) {
        console.error(`Failed to restore monitoring for pool ${poolAddress}:`, error);
      }
    }
  }

  /**
   * Get pool information by address
   * @param {string} poolAddress - Pool address
   * @param {Object} provider - Ethereum provider (optional)
   * @returns {Object} Pool information including tokens, fee, and other details
   */
  async getPool(poolAddress, provider = null) {
    // Try to get from cache first
    let cachedInfo = await this.stateManager.getCachedPoolInfo(poolAddress);

    if (cachedInfo) {
      // Return cached info without database-specific fields
      const { _id, poolAddress: addr, cachedAt, updatedAt, ...poolInfo } = cachedInfo;
      return poolInfo;
    }

    // If not cached, fetch and cache
    console.log(`Pool ${poolAddress} not cached, fetching and caching...`);
    return await this._cachePoolInfo(poolAddress, {}, provider);
  }

  /**
   * Get all available pools
   * @returns {Array} Array of all pool information
   */
  async getAllPools() {
    return await this.stateManager.getAllCachedPools();
  }

  /**
   * Find pools containing a specific token
   * @param {string} tokenAddress - Token contract address
   * @returns {Array} Array of pools containing the specified token
   */
  async findPoolsWithToken(tokenAddress) {
    return await this.stateManager.findPoolsByTokenAddress(tokenAddress);
  }

  /**
   * Find pools containing a specific token symbol
   * @param {string} tokenSymbol - Token symbol (e.g., 'ETH', 'USDC')
   * @returns {Array} Array of pools containing the specified token symbol
   */
  async findPoolsWithTokenSymbol(tokenSymbol) {
    return await this.stateManager.findPoolsByTokenSymbol(tokenSymbol);
  }

  /**
   * Find pools for a specific token pair
   * @param {string} token0Address - First token address
   * @param {string} token1Address - Second token address
   * @returns {Array} Array of pools for the specified token pair
   */
  async findPoolsForTokenPair(token0Address, token1Address) {
    return await this.stateManager.findPoolsByTokenPair(token0Address, token1Address);
  }

  /**
   * Find pools for a specific token symbol pair
   * @param {string} symbol0 - First token symbol
   * @param {string} symbol1 - Second token symbol
   * @returns {Array} Array of pools for the specified token symbol pair
   */
  async findPoolsForTokenSymbolPair(symbol0, symbol1) {
    return await this.stateManager.findPoolsByTokenSymbolPair(symbol0, symbol1);
  }

  /**
   * Get all unique tokens from available pools
   * @returns {Array} Array of unique token objects with address, symbol, and decimals
   */
  async getAvailableTokens() {
    return await this.stateManager.getAllUniqueTokens();
  }

  /**
   * Search pools by multiple criteria
   * @param {Object} criteria - Search criteria
   * @param {string} [criteria.tokenAddress] - Filter by specific token address
   * @param {string} [criteria.tokenSymbol] - Filter by specific token symbol
   * @param {Array<string>} [criteria.tokenAddresses] - Filter by multiple token addresses
   * @param {Array<string>} [criteria.tokenSymbols] - Filter by multiple token symbols
   * @param {string} [criteria.platform] - Filter by platform (uniswap, pancakeswap, etc.)
   * @param {string} [criteria.blockchain] - Filter by blockchain (arbitrum, ethereum, etc.)
   * @returns {Array} Array of pools matching the criteria
   */
  async searchPools(criteria = {}) {
    let pools = await this.getAllPools();

    // Filter by single token address
    if (criteria.tokenAddress) {
      pools = pools.filter(pool =>
        pool.token0.address.toLowerCase() === criteria.tokenAddress.toLowerCase() ||
        pool.token1.address.toLowerCase() === criteria.tokenAddress.toLowerCase()
      );
    }

    // Filter by single token symbol
    if (criteria.tokenSymbol) {
      pools = pools.filter(pool =>
        pool.token0.symbol.toLowerCase() === criteria.tokenSymbol.toLowerCase() ||
        pool.token1.symbol.toLowerCase() === criteria.tokenSymbol.toLowerCase()
      );
    }

    // Filter by multiple token addresses
    if (criteria.tokenAddresses && criteria.tokenAddresses.length > 0) {
      const lowerAddresses = criteria.tokenAddresses.map(addr => addr.toLowerCase());
      pools = pools.filter(pool =>
        lowerAddresses.includes(pool.token0.address.toLowerCase()) ||
        lowerAddresses.includes(pool.token1.address.toLowerCase())
      );
    }

    // Filter by multiple token symbols
    if (criteria.tokenSymbols && criteria.tokenSymbols.length > 0) {
      const lowerSymbols = criteria.tokenSymbols.map(symbol => symbol.toLowerCase());
      pools = pools.filter(pool =>
        lowerSymbols.includes(pool.token0.symbol.toLowerCase()) ||
        lowerSymbols.includes(pool.token1.symbol.toLowerCase())
      );
    }

    // Filter by platform
    if (criteria.platform) {
      pools = pools.filter(pool =>
        pool.platform && pool.platform.toLowerCase() === criteria.platform.toLowerCase()
      );
    }

    // Filter by blockchain
    if (criteria.blockchain) {
      pools = pools.filter(pool =>
        pool.blockchain && pool.blockchain.toLowerCase() === criteria.blockchain.toLowerCase()
      );
    }

    return pools;
  }

  // Monitoring Methods

  /**
   * Start monitoring a pool
   * @param {Object} botInstance - Telegram bot instance
   * @param {string} poolAddress - Pool contract address
   * @param {Object} poolData - Pool data including tokens info
   * @param {Object} providerInstance - Viem client instance
   * @param {string} timezone - Timezone for time display
   */
  async startMonitoring(botInstance, poolAddress, poolData, providerInstance, timezone) {
    console.log(`Starting monitoring for pool: ${poolAddress}`);

    this.monitoredPools[poolAddress] = {
      ...poolData,
      client: providerInstance,
      priceMonitoringEnabled: true, // Always set to true when starting monitoring
    };

    // Attach swap listener for price monitoring
    await this._attachSwapListener(botInstance, poolAddress, timezone);
    console.log(`Successfully started monitoring for ${poolAddress}`);

    // Save pool state to database
    await this.stateManager.savePoolState(poolAddress, this.monitoredPools[poolAddress]);
  }

  /**
   * Stop monitoring a specific pool
   * @param {string} poolAddress - Pool address to stop monitoring
   */
  async stopMonitoring(poolAddress) {
    if (this.watchUnsubscribers[poolAddress]) {
      this.watchUnsubscribers[poolAddress]();
      delete this.watchUnsubscribers[poolAddress];

      // Remove from memory
      delete this.monitoredPools[poolAddress];

      // Set monitoring flag to false in database using MongoDB directly
      await this.stateManager.poolsCollection.updateOne(
        { poolAddress },
        {
          $set: {
            priceMonitoringEnabled: false,
            updatedAt: new Date()
          }
        }
      );

      console.log(`Stopped monitoring for ${poolAddress}`);
    }
  }

  /**
   * Stop monitoring all pools
   */
  async stopAllMonitoring() {
    for (const poolAddress in this.watchUnsubscribers) {
      if (this.watchUnsubscribers[poolAddress]) {
        this.watchUnsubscribers[poolAddress]();
        delete this.watchUnsubscribers[poolAddress];
        console.log(`Removed listeners for ${poolAddress}`);
      }
    }

    // Clear memory state
    this.monitoredPools = {};

    // Stop auto-save
    this._stopAutoSave();
  }

  /**
   * Get all monitored pools
   * @returns {Object} Object containing all monitored pools
   */
  getMonitoredPools() {
    return this.monitoredPools;
  }

  /**
   * Check if a pool is being monitored
   * @param {string} poolAddress - Pool address
   * @returns {boolean} True if pool is being monitored
   */
  isMonitoring(poolAddress) {
    return Boolean(this.monitoredPools[poolAddress]);
  }

  /**
   * Close the pool service and clean up resources
   */
  async close() {
    // Stop all monitoring
    await this.stopAllMonitoring();

    if (this.stateManager) {
      await this.stateManager.close();
    }
  }

  // Private methods for internal implementation

  /**
   * Start auto-save interval
   * @private
   */
  _startAutoSave() {
    if (this.autoSaveInterval) {
      clearInterval(this.autoSaveInterval);
    }

    this.autoSaveInterval = setInterval(async () => {
      await this.stateManager.saveAllPools(this.monitoredPools);
    }, 30000); // Save every 30 seconds

    console.log('Started auto-save interval');
  }

  /**
   * Stop auto-save interval
   * @private
   */
  _stopAutoSave() {
    if (this.autoSaveInterval) {
      clearInterval(this.autoSaveInterval);
      this.autoSaveInterval = null;
      console.log('Stopped auto-save interval');
    }
  }

  /**
   * Attach a swap event listener to a pool
   * @private
   * @param {Object} botInstance - Telegram bot instance
   * @param {string} poolAddress - Pool address
   * @param {string} timezone - Timezone for time display
   */
  async _attachSwapListener(botInstance, poolAddress, timezone) {
    const poolsCollection = this.monitoredPools;
    const client = poolsCollection[poolAddress].client;

    this.watchUnsubscribers[poolAddress] = await client.watchContractEvent({
      address: poolAddress,
      abi: poolAbi,
      eventName: 'Swap',
      onLogs: (logs) => {
        logs.forEach((log) => {
          const poolInfo = poolsCollection[poolAddress];
          if (!poolInfo || !poolInfo.messageId || !poolInfo.token0 || !poolInfo.token1) {
            console.warn(`Pool info incomplete for ${poolAddress} during Swap event. Skipping.`);
            return;
          }

          const {args} = log;
          const {sqrtPriceX96, amount0, amount1, tick} = args;

          const newPriceT1T0 = parseFloat(calculatePrice(sqrtPriceX96, poolInfo.token0.decimals, poolInfo.token1.decimals));

          // Update the pool message with the same formatting but new price
          this._updatePoolMessageWithPrice(botInstance, poolAddress, poolInfo, newPriceT1T0, timezone);

          // Update position messages for positions in this pool that are in range
          this._updatePositionMessages(botInstance, poolAddress, timezone);

          this._checkPriceAlerts(botInstance, poolInfo, newPriceT1T0);
          poolInfo.lastPriceT1T0 = newPriceT1T0;
        });
      }
    });
  }

  /**
   * Update pool message with new price while keeping the same formatting
   * @private
   * @param {Object} botInstance - Telegram bot instance
   * @param {string} poolAddress - Pool address
   * @param {Object} poolInfo - Pool information
   * @param {number} newPrice - New price
   * @param {string} timezone - Timezone for time display
   */
  async _updatePoolMessageWithPrice(botInstance, poolAddress, poolInfo, newPrice, timezone) {
    try {
      // Reuse the existing message updating logic from pool command handler
      const PoolHandler = require('../telegram/commands/pool');

      await PoolHandler.sendOrUpdatePoolMessage(
        botInstance,
        poolInfo.chatId,
        poolInfo.messageId,
        poolAddress,
        null, // provider not needed when using pre-calculated price
        {
          preCalculatedPrice: newPrice,
          includeTimestamp: true
        }
      );

    } catch (error) {
      console.error(`Error updating pool message for ${poolAddress} in chat ${poolInfo.chatId}: ${error.message}`);
    }
  }

  /**
   * Check price alerts for a pool
   * @private
   * @param {Object} botInstance - Telegram bot instance
   * @param {Object} poolInfo - Pool information
   * @param {number} newPriceT1T0 - New price
   */
  _checkPriceAlerts(botInstance, poolInfo, newPriceT1T0) {
    const lastPrice = poolInfo.lastPriceT1T0;
    let notificationsChanged = false;

    poolInfo.notifications = (poolInfo.notifications || []).filter(notification => {
      if (!notification.triggered) {
        const crossesUp = lastPrice < notification.targetPrice && newPriceT1T0 >= notification.targetPrice;
        const crossesDown = lastPrice > notification.targetPrice && newPriceT1T0 <= notification.targetPrice;

        if (crossesUp || crossesDown) {
          const direction = crossesUp ? "rose above" : "fell below";
          const alertMessage = `🔔 Price Alert! 🔔\nPool: ${poolInfo.token1.symbol}/${poolInfo.token0.symbol}\nPrice ${direction} ${notification.targetPrice.toFixed(8)}.\nCurrent Price: ${newPriceT1T0.toFixed(8)}`;

          botInstance.sendMessage(notification.originalChatId, alertMessage);
          console.log(`Notification triggered for chat ${notification.originalChatId}: ${poolInfo.token1.symbol}/${poolInfo.token0.symbol} at ${newPriceT1T0}, target ${notification.targetPrice}`);
          notification.triggered = true;
          notificationsChanged = true;
          return false;
        }
      }
      return !notification.triggered;
    });

    // Save state if notifications changed
    if (notificationsChanged) {
      // Find pool address from poolInfo
      const poolAddress = Object.keys(this.monitoredPools).find(addr =>
        this.monitoredPools[addr] === poolInfo
      );

      if (poolAddress) {
        this.stateManager.savePoolState(poolAddress, poolInfo).catch(err => {
          console.error(`Error saving state after alert trigger for ${poolAddress}:`, err.message);
        });
      }
    }
  }

  /**
   * Update position messages for positions in this pool that are in range
   * @private
   * @param {Object} botInstance - Telegram bot instance
   * @param {string} poolAddress - Pool address
   * @param {string} timezone - Timezone for time display
   */
  async _updatePositionMessages(botInstance, poolAddress, timezone) {
    try {
      // Get positions that are in range for this pool
      const positions = await this.stateManager.getInRangePositionsByPool(poolAddress);

      if (positions.length === 0) {
        return; // No positions to update
      }

      // Import PositionMonitor to get updated position data
      const PositionMonitor = require('./position-monitor');

      for (const storedPosition of positions) {
        try {
          // Create a temporary position monitor instance to get updated position data
          const tempMonitor = new PositionMonitor(this.monitoredPools[poolAddress]?.client, this.stateManager);

          // Get fresh position details with updated token amounts
          const updatedPosition = await tempMonitor.getPositionDetails(BigInt(storedPosition.tokenId), storedPosition.isStaked);

          if (updatedPosition.error) {
            console.warn(`Error getting updated position details for token ID ${storedPosition.tokenId}:`, updatedPosition.error);
            continue;
          }

          // Use the unified position formatting method for updates
          const positionMessage = new PositionMessage(updatedPosition, true);
          const updatedMessage = positionMessage.toString();

          // Update the message in Telegram
          await botInstance.editMessageText(updatedMessage, {
            chat_id: storedPosition.chatId,
            message_id: storedPosition.messageId,
            parse_mode: 'Markdown',
            disable_web_page_preview: true
          });

          // Update position data in MongoDB
          await this.stateManager.updatePosition(
            storedPosition.tokenId,
            storedPosition.walletAddress,
            storedPosition.chatId,
            {
              token0Amount: updatedPosition.token0Amount,
              token1Amount: updatedPosition.token1Amount,
              currentPrice: updatedPosition.currentPrice,
              inRange: updatedPosition.inRange,
              liquidity: updatedPosition.liquidity?.toString()
            }
          );

          console.log(`Updated position message for token ID ${storedPosition.tokenId} in chat ${storedPosition.chatId}`);

        } catch (error) {
          console.error(`Error updating position message for token ID ${storedPosition.tokenId}:`, error.message);
        }
      }

    } catch (error) {
      console.error(`Error updating position messages for pool ${poolAddress}:`, error.message);
    }
  }

  /**
   * Cache all pre-configured pools
   * @private
   */
  async _cachePreConfiguredPools() {
    console.log('Caching pre-configured pools...');

    // Get all enabled pools from the hierarchical structure
    const enabledPools = poolsConfig.getEnabledPools();

    for (const poolConfig of enabledPools) {
      try {
        // Check if already cached
        const cached = await this.stateManager.getCachedPoolInfo(poolConfig.address);
        if (cached) {
          console.log(`Pool ${poolConfig.address} already cached, skipping`);
          continue;
        }

        // Cache the pool information with metadata
        await this._cachePoolInfo(poolConfig.address, {
          platform: poolConfig.platform,
          blockchain: poolConfig.blockchain
        });
        console.log(`Cached pre-configured pool: ${poolConfig.platform}/${poolConfig.blockchain} - ${poolConfig.address}`);
      } catch (error) {
        console.error(`Failed to cache pre-configured pool ${poolConfig.address} (${poolConfig.platform}/${poolConfig.blockchain}):`, error.message);
      }
    }
  }

  /**
   * Cache pool information with additional metadata
   * @private
   * @param {string} poolAddress - Pool address to cache
   * @param {Object} metadata - Additional metadata (platform, blockchain, etc.)
   * @param {Object} provider - Ethereum provider (optional, will use default if not provided)
   */
  async _cachePoolInfo(poolAddress, metadata = {}, provider = null) {
    if (!isValidEthereumAddress(poolAddress)) {
      throw new Error('Invalid pool address');
    }

    // Create pool contract
    const poolContract = createPoolContract(poolAddress);

    // Get pool static information
    const [token0Address, token1Address, fee, tickSpacing, slot0] = await Promise.all([
      poolContract.read.token0(),
      poolContract.read.token1(),
      poolContract.read.fee(),
      poolContract.read.tickSpacing(),
      poolContract.read.slot0()
    ]);

    // Get token information
    const [token0Info, token1Info] = await Promise.all([
      getTokenInfo(token0Address),
      getTokenInfo(token1Address)
    ]);

    // Prepare pool info for caching
    const poolInfo = {
      token0: token0Info,
      token1: token1Info,
      fee,
      tickSpacing,
      sqrtPriceX96: slot0[0],
      tick: slot0[1],
      observationIndex: slot0[2],
      observationCardinality: slot0[3],
      observationCardinalityNext: slot0[4],
      feeProtocol: slot0[5],
      unlocked: slot0[6],
      // Add metadata for future filtering capabilities
      ...metadata
    };

    // Cache the information
    await this.stateManager.cachePoolInfo(poolAddress, poolInfo);

    return poolInfo;
  }

  /**
   * Calculate TVL for a Uniswap V3 pool using token balances
   * @param {Object} poolInfo - Pool information object
   * @param {string} poolAddress - Pool address
   * @returns {Promise<number|null>} TVL value or null if calculation fails
   */
  async getPoolTVL(poolInfo, poolAddress) {
    try {
      // Get token balances in the pool directly
      const { createErc20Contract } = require('./contracts');

      const token0Contract = createErc20Contract(poolInfo.token0.address);
      const token1Contract = createErc20Contract(poolInfo.token1.address);

      // Get token balances in the pool
      const [token0Balance, token1Balance] = await Promise.all([
        token0Contract.read.balanceOf([poolAddress]),
        token1Contract.read.balanceOf([poolAddress])
      ]);

      // Convert to human readable amounts
      const token0Amount = parseFloat(token0Balance) / Math.pow(10, poolInfo.token0.decimals);
      const token1Amount = parseFloat(token1Balance) / Math.pow(10, poolInfo.token1.decimals);

      // Get current price from pool
      const { createPoolContract } = require('./contracts');
      const poolContract = createPoolContract(poolAddress);
      const slot0 = await poolContract.read.slot0();
      const sqrtPriceX96 = slot0[0];

      // Calculate price using the existing utility function
      const { calculatePrice } = require('./utils');
      const currentPrice = parseFloat(calculatePrice(sqrtPriceX96, poolInfo.token0.decimals, poolInfo.token1.decimals));

      // Calculate TVL (assuming token1 is stablecoin like USDC)
      const token0ValueInToken1 = token0Amount * currentPrice;
      const totalTVL = token0ValueInToken1 + token1Amount;

      return totalTVL;

    } catch (error) {
      console.error('Error calculating pool TVL:', error);
      return null;
    }
  }
}

// Export singleton instance
const poolService = new PoolService();
module.exports = poolService;

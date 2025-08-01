/**
 * Individual Pool Class
 * Represents a single pool with its own address and operations
 */
const { EventEmitter } = require('events');
const { getTokenInfo, createPoolContract, createFactoryContract } = require('./contracts');
const { isValidEthereumAddress, calculatePrice } = require('./utils');
const { uniswapV3Pool: poolAbi } = require('./abis');
const { getTimeInTimezone } = require('../../utils');
const { mongoose } = require('../database/mongoose');
const { getProvider } = require('../blockchain/provider');
const TokenService = require('./token');

class Pool extends EventEmitter {
  static #poolInstances = new Map();

  /**
   * Gets singleton instance of Pool. Each pool must be a single instance because
   * they listen to blockchain events and all events must be handled by one object for efficiency
   * @param {string} address - Pool contract address
   * @param {*} provider - Optional custom provider
   * @param {*} mongoOverride - Optional MongoDB instance override
   * @returns {Pool} Singleton pool instance
   */
  static getPool(address, provider = null, mongoOverride = null) {
    if (!Pool.#poolInstances.has(address)) {
      Pool.#poolInstances.set(address, new Pool(address, provider, mongoOverride));
    }
    return Pool.#poolInstances.get(address);
  }

  /**
   * Get pool data from factory
   * @param {string} token0Address - Token0 address
   * @param {string} token1Address - Token1 address
   * @param {number} fee - Pool fee
   * @returns {Promise<Pool>} Pool
   */
  static async getPoolOfTokens(token0Address, token1Address, fee) {
    try {
      // Query MongoDB directly for pool with these specific tokens and fee
      const existingPool = await mongoose.findPoolByTokensAndFee(
        token0Address,
        token1Address,
        fee / 10000 // Convert to percentage format used in storage
      );
      if (existingPool) return this.getPool(existingPool.address);

      // If not found in database, query the factory contract
      const factoryContract = createFactoryContract();

      const poolAddress = await factoryContract.read.getPool([token0Address, token1Address, fee]);

      if (poolAddress && poolAddress !== '0x0000000000000000000000000000000000000000') {
        return this.getPool(poolAddress);
      } else {
        throw new Error('Pool not found');
      }
    } catch (error) {
      console.error('Error getting pool data:', error);
      return null;
    }
  }

  constructor(address, provider = null, mongoOverride = null) {
    super();

    if (isValidEthereumAddress(address)) {
      this.address = address;
    } else {
      throw new Error('Invalid pool address');
    }
    this.provider = provider || getProvider();
    this.mongoose = mongoOverride || mongoose;

    this.contract = createPoolContract(address);

    // Pool-specific properties
    this.info = null;
    this.isMonitoring = false;
    this.watchUnsubscriber = null;
  }

  /**
   * Get pool information
   * @returns {Object} Pool information including tokens, fee, and other details
   */
  async getPoolInfo() {
    if (!this.info) {
      // Try to get from cache first
      let cachedInfo = await this.mongoose.getCachedPoolInfo(this.address);

      if (cachedInfo) {
        this.info = cachedInfo;
        return;
      }

      // If not cached, fetch from blockchain
      console.log(`Pool ${this.address} not cached, fetching from blockchain...`);

      // Get pool static information
      const [token0Address, token1Address, fee, tickSpacing, slot0] = await Promise.all([
        this.contract.read.token0(),
        this.contract.read.token1(),
        this.contract.read.fee(),
        this.contract.read.tickSpacing(),
        this.contract.read.slot0()
      ]);

      // Get token information and ensure they are cached in database
      const [token0Info, token1Info] = await Promise.all([
        getTokenInfo(token0Address),
        getTokenInfo(token1Address)
      ]);

      // Cache tokens in database
      await Promise.all([
        this.mongoose.cacheToken(token0Address, 42161, {
          symbol: token0Info.symbol,
          decimals: token0Info.decimals,
          name: token0Info.name
        }),
        this.mongoose.cacheToken(token1Address, 42161, {
          symbol: token1Info.symbol,
          decimals: token1Info.decimals,
          name: token1Info.name
        })
      ]);

      // Calculate TVL
      const tvl = await this.getTVL();

      // Prepare pool info for runtime use
      this.info = {
        token0: token0Info, // Keep for runtime use
        token1: token1Info, // Keep for runtime use
        fee: fee / 10000,
        tickSpacing,
        unlocked: slot0[6],
        tvl: tvl
      };

      // Prepare data for database storage with token addresses
      const poolDataForStorage = {
        token0: token0Address.toLowerCase(), // Store token address directly
        token1: token1Address.toLowerCase(), // Store token address directly
        fee: fee / 10000,
        tickSpacing,
        unlocked: slot0[6]
      };

      // Cache the information
      await this.mongoose.cachePoolInfo(this.address, poolDataForStorage);
    }
    return this.info;
  }

  /**
   * Get current price for this pool
   * @returns {Promise<number|null>} Current price or null if failed
   */
  async getCurrentPrice() {
    try {
      const slot0 = await this.contract.read.slot0();
      const sqrtPriceX96 = slot0[0];

      // in case not yet loaded
      await this.getPoolInfo();

      return parseFloat(calculatePrice(sqrtPriceX96, this.info.token0.decimals, this.info.token1.decimals));
    } catch (error) {
      console.error(`Error getting price for pool ${this.address}:`, error.message);
      return null;
    }
  }

  /**
   * Calculate TVL for this pool
   * @returns {Promise<number|null>} TVL value or null if calculation fails
   */
  async getTVL() {
    try {
      const tokenService = new TokenService(this.provider);

      // Get token information from TokenService
      const [token0Info, token1Info] = await Promise.all([
        tokenService.getToken(this.info.token0.address),
        tokenService.getToken(this.info.token1.address)
      ]);

      // Get token balances in the pool
      const [token0Balance, token1Balance] = await Promise.all([
        token0Info.contract.read.balanceOf([this.address]),
        token1Info.contract.read.balanceOf([this.address])
      ]);

      // Convert to human readable amounts
      const token0Amount = parseFloat(token0Balance) / Math.pow(10, this.info.token0.decimals);
      const token1Amount = parseFloat(token1Balance) / Math.pow(10, this.info.token1.decimals);

      // Get current price
      const currentPrice = await this.getCurrentPrice();
      if (!currentPrice) {
        throw new Error('Failed to get current price');
      }

      // Calculate TVL (assuming token1 is stablecoin like USDC)
      return token0Amount * currentPrice + token1Amount;
    } catch (error) {
      console.error(`Error calculating TVL for pool ${this.address}:`, error);
      return null;
    }
  }

  /**
   * Start monitoring this pool
   */
  async startMonitoring() {
    if (this.isMonitoring) return;

    await this.getPoolInfo();

    const price = await this.getCurrentPrice();
    if (!price) {
      throw new Error('Failed to get current price for monitoring');
    }

    // Initialize monitoring data
    this.monitoringData = {
      lastPriceT1T0: price,
      notifications: []
    };

    // Start listening for swap events
    await this._attachSwapListener();
    this.isMonitoring = true;

    console.log(`Started monitoring pool ${this.info.token0.symbol}/${this.info.token1.symbol} (${this.info.fee}%)`);

    // Save monitoring state
    await this._saveMonitoringState();

    return {
      info: this.info,
      price
    };
  }

  /**
   * Stop monitoring this pool
   */
  async stopMonitoring() {
    if (!this.isMonitoring) {
      return;
    }

    if (this.watchUnsubscriber) {
      this.watchUnsubscriber();
      this.watchUnsubscriber = null;
    }

    this.isMonitoring = false;
    this.monitoringData = null;

    // Update monitoring state in database
    await this.mongoose.savePoolState(this.address, {
      priceMonitoringEnabled: false,
      updatedAt: new Date()
    });
    console.log(`Stopped monitoring pool ${this.info.token0.symbol}/${this.info.token1.symbol} (${this.info.fee}%)`);
  }

  /**
   * Add price alert for this pool
   * @param {number} targetPrice - Target price for alert
   * @param {number} originalChatId - Original chat ID for notification
   */
  addPriceAlert(targetPrice, originalChatId) {
    if (!this.isMonitoring || !this.monitoringData) {
      throw new Error('Pool is not being monitored');
    }

    this.monitoringData.notifications.push({
      targetPrice,
      originalChatId,
      triggered: false,
      createdAt: new Date()
    });

    // Save updated state
    this._saveMonitoringState();
  }

  /**
   * Get monitoring status
   * @returns {boolean} True if pool is being monitored
   */
  getMonitoringStatus() {
    return this.isMonitoring;
  }

  /**
   * Get monitoring data
   * @returns {Object|null} Monitoring data or null if not monitoring
   */
  getMonitoringData() {
    return this.monitoringData;
  }

  /**
   * Close pool instance and clean up resources
   */
  async close() {
    await this.stopMonitoring();

    if (this.mongoose) {
      // Note: mongoose connection is shared, so we don't close it here
      // await this.mongoose.disconnect();
    }
  }

  // Private methods

  /**
   * Attach swap event listener
   * @private
   */
  async _attachSwapListener() {
    this.watchUnsubscriber = await this.provider.watchContractEvent({
      address: this.address,
      abi: poolAbi,
      eventName: 'Swap',
      onLogs: (logs) => {
        logs.forEach((log) => {
          if (!this.monitoringData || !this.info) {
            console.warn(`Pool info incomplete for ${this.address} during Swap event. Skipping.`);
            return;
          }

          const { args } = log;
          const { sqrtPriceX96, amount0, amount1, tick } = args;

          const newPriceT1T0 = parseFloat(calculatePrice(sqrtPriceX96, this.info.token0.decimals, this.info.token1.decimals));

          // Prepare swap information
          const swapInfo = {
            address: this.address,
            transactionHash: log.transactionHash,
            blockNumber: log.blockNumber,
            logIndex: log.logIndex,
            sender: args.sender,
            recipient: args.recipient,
            amount0: args.amount0,
            amount1: args.amount1,
            sqrtPriceX96: args.sqrtPriceX96,
            liquidity: args.liquidity,
            tick: args.tick,
            newPrice: newPriceT1T0,
            timestamp: getTimeInTimezone(this.timezone)
          };

          // Prepare pool information
          const poolData = {
            address: this.address,
            token0: this.info.token0,
            token1: this.info.token1,
            fee: this.info.fee,
            platform: this.info.platform,
            blockchain: this.info.blockchain,
            currentPrice: newPriceT1T0,
            lastPrice: this.monitoringData.lastPriceT1T0
          };

          // Emit swap event
          this.emit('swap', swapInfo, poolData);

          this.monitoringData.lastPriceT1T0 = newPriceT1T0;
        });
      }
    });
  }

  /**
   * Save monitoring state to database
   * @private
   */
  async _saveMonitoringState() {
    if (!this.monitoringData) {
      return;
    }

    try {
      // Prepare monitoring data for storage, excluding notifications
      const { notifications, ...monitoringDataForStorage } = this.monitoringData;

      await this.mongoose.savePoolState(this.address, {
        ...monitoringDataForStorage,
        priceMonitoringEnabled: this.isMonitoring
      });
    } catch (error) {
      console.error(`Error saving monitoring state for pool ${this.address}:`, error.message);
    }
  }
}

module.exports = {
  Pool,
  getPool: Pool.getPool,
};

const awilix = require('awilix');
const { EventEmitter } = require('events');
const { calculatePrice } = require('./utils');
const { uniswapV3Pool: poolAbi } = require('./abis');
const { getTimeInTimezone } = require('../../utils');

/**
 * Represents a Uniswap V3 pool for a pair of tokens.
 * Handles pool monitoring, price tracking, and event emission.
 */
class Pool extends EventEmitter {
  constructor(contract, model) {
    super();

    this.contract = contract;
    this.model = model;

    // Pool-specific properties
    this.isMonitoring = false;
    this.watchUnsubscriber = null;
  }

  /**
   * Start monitoring this pool
   */
  async startMonitoring() {
    if (this.isMonitoring) return;

    await this.getPoolInfo();

    const price = await this.getPrice();
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
    await this.model.savePoolState(this.address, {
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

    if (this.model) {
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
      contract: poolAbi,
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

      await this.model.savePoolState(this.address, {
        ...monitoringDataForStorage,
        priceMonitoringEnabled: this.isMonitoring
      });
    } catch (error) {
      console.error(`Error saving monitoring state for pool ${this.address}:`, error.message);
    }
  }
}

module.exports = (container) => {
  container.register({
  })
};

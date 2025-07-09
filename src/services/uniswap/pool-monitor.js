/**
 * Pool database service
 * Handles database of Uniswap pools and price alerts
 */
const { formatUnits, parseEventLogs } = require('viem');
const { getTimeInTimezone } = require('../../utils/time');
const { calculatePrice } = require('./utils');
const { uniswapV3Pool: poolAbi } = require('./abis');
const MongoStateManager = require('../database/mongo');

/**
 * Class for database Uniswap V3 pools
 */
class PoolMonitor {
  constructor() {
    this.monitoredPools = {};
    this.watchUnsubscribers = {};
    this.stateManager = new MongoStateManager();
    this.autoSaveInterval = null;
  }

  /**
   * Initialize the pool monitor
   * Connects to database and restores database state
   * @param {Object} botInstance - Telegram bot instance
   * @param {Object} providerInstance - Viem client instance
   * @param {string} timezone - Timezone for time display
   */
  async initialize(botInstance, providerInstance, timezone) {
    console.log('Initializing PoolMonitor...');

    // Connect to MongoDB
    await this.stateManager.connect();

    // Start auto-save interval (every 30 seconds)
    this.startAutoSave();

    // Load saved state
    const savedState = await this.stateManager.loadAllPools();

    // Restore database for each saved pool
    for (const [poolAddress, poolData] of Object.entries(savedState)) {
      try {
        await this.startMonitoring(
          botInstance,
          poolAddress,
          poolData,
          providerInstance,
          timezone
        );
        console.log(`Restored monitoring for pool: ${poolAddress}`);
      } catch (error) {
        console.error(`Failed to restore monitoring for pool ${poolAddress}:`, error);
      }
    }
  }

  /**
   * Start database a pool
   * @param {Object} botInstance - Telegram bot instance
   * @param {string} poolAddress - Pool contract address
   * @param {Object} poolData - Pool data including tokens info
   * @param {Object} providerInstance - Viem client instance
   * @param {string} timezone - Timezone for time display
   */
  async startMonitoring(botInstance, poolAddress, poolData, providerInstance, timezone) {
    console.log(`Attempting to monitor pool: ${poolAddress}`);

    this.monitoredPools[poolAddress] = {
      ...poolData,
      client: providerInstance,
    };

    await this._attachSwapListener(botInstance, poolAddress, timezone);
    console.log(`Successfully attached Swap listener for ${poolAddress}`);

    // Save pool state to database
    await this.stateManager.savePoolState(poolAddress, this.monitoredPools[poolAddress]);
  }

  /**
   * Stop database a specific pool
   * @param {string} poolAddress - Pool address to stop database
   */
  async stopMonitoring(poolAddress) {
    if (this.watchUnsubscribers[poolAddress]) {
      this.watchUnsubscribers[poolAddress]();
      delete this.watchUnsubscribers[poolAddress];

      // Remove from memory
      delete this.monitoredPools[poolAddress];

      // Remove from database
      await this.stateManager.removePool(poolAddress);

      console.log(`Stopped monitoring for ${poolAddress}`);
    }
  }

  /**
   * Stop database all pools
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
    this.stopAutoSave();
  }

  /**
   * Start auto-save interval
   */
  startAutoSave() {
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
   */
  stopAutoSave() {
    if (this.autoSaveInterval) {
      clearInterval(this.autoSaveInterval);
      this.autoSaveInterval = null;
      console.log('Stopped auto-save interval');
    }
  }

  /**
   * Get all monitored pools
   * @returns {Object} Object containing all monitored pools
   */
  getMonitoredPools() {
    return this.monitoredPools;
  }

  /**
   * Attach a swap event listener to a pool
   * @private
   */
  async _attachSwapListener(botInstance, poolAddress, timezone) {
    const poolsCollection = this.monitoredPools;
    const client = poolsCollection[poolAddress].client;

    const unsubscribe = await client.watchContractEvent({
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

          const { args } = log;
          const { sqrtPriceX96, amount0, amount1, tick } = args;

          const newPriceT1T0 = parseFloat(calculatePrice(sqrtPriceX96, poolInfo.token0.decimals, poolInfo.token1.decimals));
          let volume;
          let volumeTokenSymbol;

          const amount1Abs = amount1 < 0n ? -amount1 : amount1;
          const amount0Abs = amount0 < 0n ? -amount0 : amount0;

          if (amount1Abs > 0n) {
            volume = formatUnits(amount1Abs, poolInfo.token1.decimals);
            volumeTokenSymbol = poolInfo.token1.symbol;
          } else {
            volume = formatUnits(amount0Abs, poolInfo.token0.decimals);
            volumeTokenSymbol = poolInfo.token0.symbol;
          }

          const eventTime = getTimeInTimezone(timezone);
          const updatedText = `${newPriceT1T0.toFixed(8)} ${poolInfo.token1.symbol}/${poolInfo.token0.symbol} ${eventTime}\nTick: ${tick}\nLast Swap: ${volume} ${volumeTokenSymbol}`;

          botInstance.editMessageText(updatedText, {
            chat_id: poolInfo.chatId,
            message_id: poolInfo.messageId
          }).catch(error => {
            console.error(`Error editing message for pool ${poolAddress} in chat ${poolInfo.chatId}: ${error.message}`);
          });

          this._checkPriceAlerts(botInstance, poolInfo, newPriceT1T0);
          poolInfo.lastPriceT1T0 = newPriceT1T0;
        });
      }
    });

    this.watchUnsubscribers[poolAddress] = unsubscribe;
  }

  /**
   * Check price alerts for a pool
   * @private
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
}

// Export singleton instance
const poolMonitor = new PoolMonitor();
module.exports = poolMonitor;

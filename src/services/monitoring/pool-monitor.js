/**
 * Pool monitoring service
 * Handles monitoring of Uniswap pools and price alerts
 */
const { ethers } = require('ethers');
const { getTimeInTimezone } = require('../../utils/time');
const { calculatePrice } = require('../blockchain/price-calculator');
const { uniswapV3Pool: poolAbi } = require('../../../data/abis');

/**
 * Class for monitoring Uniswap V3 pools
 */
class PoolMonitor {
  constructor() {
    this.monitoredPools = {};
  }

  /**
   * Start monitoring a pool
   * @param {Object} botInstance - Telegram bot instance
   * @param {string} poolAddress - Pool contract address
   * @param {Object} poolData - Pool data including tokens info
   * @param {Object} providerInstance - Ethereum provider
   * @param {string} timezone - Timezone for time display
   */
  async startMonitoring(botInstance, poolAddress, poolData, providerInstance, timezone) {
    console.log(`Attempting to monitor pool: ${poolAddress}`);

    const poolContract = new ethers.Contract(poolAddress, poolAbi, providerInstance);
    this.monitoredPools[poolAddress] = {
      ...poolData,
      contract: poolContract,
    };

    this._attachSwapListener(botInstance, poolAddress, timezone);
    console.log(`Successfully attached Swap listener for ${poolAddress}`);
  }

  /**
   * Stop monitoring all pools
   */
  stopAllMonitoring() {
    for (const poolAddress in this.monitoredPools) {
      if (this.monitoredPools[poolAddress] && this.monitoredPools[poolAddress].contract) {
        this.monitoredPools[poolAddress].contract.removeAllListeners('Swap');
        console.log(`Removed listeners for ${poolAddress}`);
      }
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
  _attachSwapListener(botInstance, poolAddress, timezone) {
    const poolsCollection = this.monitoredPools;
    const poolContract = poolsCollection[poolAddress].contract;

    poolContract.on('Swap', (sender, recipient, amount0, amount1, sqrtPriceX96Swap, liquidity, tickSwap, protocolFeesToken0, protocolFeesToken1, event) => {
      const poolInfo = poolsCollection[poolAddress];
      if (!poolInfo || !poolInfo.messageId || !poolInfo.token0 || !poolInfo.token1) {
        console.warn(`Pool info incomplete for ${poolAddress} during Swap event. Skipping.`);
        return;
      }

      const newPriceT1T0 = parseFloat(calculatePrice(sqrtPriceX96Swap, poolInfo.token1.decimals, poolInfo.token0.decimals));
      let volume;
      let volumeTokenSymbol;

      if (ethers.BigNumber.from(amount1).abs().gt(0)) {
        volume = ethers.utils.formatUnits(amount1.abs(), poolInfo.token1.decimals);
        volumeTokenSymbol = poolInfo.token1.symbol;
      } else {
        volume = ethers.utils.formatUnits(amount0.abs(), poolInfo.token0.decimals);
        volumeTokenSymbol = poolInfo.token0.symbol;
      }

      const eventTime = getTimeInTimezone(timezone);
      const updatedText = `${newPriceT1T0.toFixed(8)} ${poolInfo.token1.symbol}/${poolInfo.token0.symbol} ${eventTime}
Tick: ${tickSwap}
Last Swap: ${volume} ${volumeTokenSymbol}`;

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

  /**
   * Check price alerts for a pool
   * @private
   */
  _checkPriceAlerts(botInstance, poolInfo, newPriceT1T0) {
    const lastPrice = poolInfo.lastPriceT1T0;

    poolInfo.notifications = (poolInfo.notifications || []).filter(notification => {
      if (!notification.triggered) {
        const crossesUp = lastPrice < notification.targetPrice && newPriceT1T0 >= notification.targetPrice;
        const crossesDown = lastPrice > notification.targetPrice && newPriceT1T0 <= notification.targetPrice;

        if (crossesUp || crossesDown) {
          const direction = crossesUp ? "rose above" : "fell below";
          const alertMessage = `🔔 Price Alert! 🔔
Pool: ${poolInfo.token1.symbol}/${poolInfo.token0.symbol}
Price ${direction} ${notification.targetPrice.toFixed(8)}.
Current Price: ${newPriceT1T0.toFixed(8)}`;

          botInstance.sendMessage(notification.originalChatId, alertMessage);
          console.log(`Notification triggered for chat ${notification.originalChatId}: ${poolInfo.token1.symbol}/${poolInfo.token0.symbol} at ${newPriceT1T0}, target ${notification.targetPrice}`);
          notification.triggered = true;
          return false;
        }
      }
      return !notification.triggered;
    });
  }
}

// Export singleton instance
const poolMonitor = new PoolMonitor();
module.exports = poolMonitor;

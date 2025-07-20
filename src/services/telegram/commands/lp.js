const Position = require('../../uniswap/position');
const TelegramMessage = require("../message");
const { getTimeInTimezone, moneyFormat } = require('../../../utils');

/**
 * Message classes for different LP command scenarios
 */
class NoWalletsMessage extends TelegramMessage {
  constructor(chatId) {
    super();
    this.chatId = chatId;
  }

  toString() {
    return "💼 No wallets are currently being monitored.\n\nUse /wallet <address> to start monitoring a wallet.";
  }
}

class WalletLoadingMessage extends TelegramMessage {
  constructor(chatId, walletIndex, walletAddress) {
    super();
    this.chatId = chatId;
    this.walletIndex = walletIndex;
    this.walletAddress = walletAddress;
  }

  toString() {
    return `💼 **Wallet ${this.walletIndex + 1}:** \`${this.walletAddress}\`\n⏳ Loading positions...`;
  }

  getOptions() {
    return { parse_mode: 'Markdown' };
  }
}

class NoPositionsMessage extends TelegramMessage {
  constructor(chatId, messageId) {
    super();
    this.chatId = chatId;
    this.id = messageId;
  }

  toString() {
    return "No active positions found in this wallet.";
  }

  getOptions() {
    return { parse_mode: 'Markdown', disable_web_page_preview: true };
  }
}

/**
 * Reply to position message notifying price is out of range. Delete when back in range.
 */
class RangeNotificationMessage extends TelegramMessage {
  constructor(position, chatId, replyToMessageId) {
    super();
    this.chatId = chatId;
    this.position = position;
    this.replyToMessageId = replyToMessageId;
  }

  toString() {
    return `⚠️ **Position Out of Range**`;
  }

  getOptions() {
    return {
      parse_mode: 'Markdown',
      reply_to_message_id: this.replyToMessageId
    };
  }
}

class PositionMessage extends TelegramMessage {
  constructor(position) {
    super();
    this.position = position;
  }

  toString() {
    if (!this.position || this.position.error) {
      return `❌ Error loading position: ${this.position?.error || 'Unknown error'}`;
    }

    const { position } = this;
    const feePercent = (position.fee / 10000).toFixed(2);
    const positionLink = `https://pancakeswap.finance/liquidity/${position.tokenId}?chain=arb&persistChain=1`;

    // Format components
    const rangeIcon = position.inRange ? '🟢' : '🔴';
    const timestamp = getTimeInTimezone();

    const header = `${rangeIcon} $${moneyFormat(parseFloat(position.currentPrice))}`;

    // Build fees line with CAKE rewards
    let feesLine = '';
    if (position.fees) {
      feesLine = `💸 $${moneyFormat(position.fees.totalValue)}`;
      if (position.fees.cakeRewards) {
        feesLine += ` 🍪 $${moneyFormat(position.fees.cakeRewards.value)}`;
      }
      feesLine += `\n`;
    }

    const amounts = `💰 ${parseFloat(position.token0Amount).toFixed(4)} ${position.token0.symbol} + ${parseFloat(position.token1Amount).toFixed(2)} ${position.token1.symbol}`;
    const time = `⏰ ${timestamp}`;
    const stakingStatus = position.isStaked ? '🥩 STAKED' : '💼 UNSTAKED';
    const priceRange = `${stakingStatus} | $${moneyFormat(parseFloat(position.lowerPrice))} - $${moneyFormat(parseFloat(position.upperPrice))}`;
    const poolInfo = `${position.token0.symbol}/${position.token1.symbol} (${feePercent}%) - [#${position.tokenId}](${positionLink})`;

    return `${header}\n${feesLine}${time}\n${amounts}\n${priceRange}\n${poolInfo}`;
  }

  getOptions() {
    return { parse_mode: 'Markdown', disable_web_page_preview: true };
  }
}

class GeneralErrorMessage extends TelegramMessage {
  constructor(chatId, error) {
    super();
    this.chatId = chatId;
    this.error = error;
  }

  toString() {
    return `❌ Error fetching liquidity positions: ${this.error}`;
  }
}

/**
 * Handler for /lp command - Lists liquidity positions for monitored wallets
 */
class LpHandler {
  /**
   * Creates an instance of LpHandler
   * @param {Object} bot - Telegram bot instance
   * @param {Object} db - Database service instance
   * @param {Object} walletService - Wallet service instance
   */
  constructor(bot, db, walletService) {
    this.bot = bot;
    this.db = db;
    this.walletService = walletService;
    this.positionMessages = new Map(); // tokenId => PositionMessage
    this.rangeNotificationMessages = new Map(); // tokenId => RangeNotificationMessage
    this.swapEventListener = (swapInfo, poolData) => this.onSwap(swapInfo, poolData);

    this.registerHandlers();
    // Start restoration process asynchronously
    this.restoreMonitoredPositions().catch(error => {
      console.error('Error during position monitoring restoration:', error);
    });
  }

  /**
   * Registers bot command handlers for the /lp command
   * @returns {void}
   */
  registerHandlers() {
    this.bot.onText(/\/lp/, (msg) => this.handleCommand(msg));
  }

  /**
   * Handles the /lp command by processing monitored wallets and their positions
   * @param {Object} msg - Telegram message object
   * @returns {Promise<void>}
   */
  async handleCommand(msg) {
    const chatId = msg.chat.id;
    const monitoredWallets = this.walletService.getWalletsForChat(chatId);

    if (monitoredWallets.length === 0) {
      await this.bot.send(new NoWalletsMessage(chatId));
      return;
    }

    try {
      await this.processWallets(chatId, monitoredWallets);
    } catch (error) {
      console.error('Error in LP handler:', error);
      await this.bot.send(new GeneralErrorMessage(chatId, error.message));
    }
  }

  /**
   * Processes all monitored wallets for a chat, fetching and displaying their positions
   * @param {string} chatId - Telegram chat ID
   * @param {string[]} wallets - Array of wallet addresses to process
   * @returns {Promise<void>}
   */
  async processWallets(chatId, wallets) {
    for (let i = 0; i < wallets.length; i++) {
      const walletAddress = wallets[i];
      const loadingMessage = await this.bot.send(new WalletLoadingMessage(chatId, i, walletAddress));

      try {
        const positions = await Position.fetchPositions(walletAddress);
        await this.processPositions(chatId, walletAddress, positions, loadingMessage);
      } catch (error) {
        console.error(`Error processing wallet ${walletAddress}:`, error);
        await this.bot.send(new GeneralErrorMessage(chatId, `Error processing wallet: ${error.message}`));
      }
    }
  }

  /**
   * Processes positions for a wallet, sending messages and starting monitoring
   * @param {string} chatId - Telegram chat ID
   * @param {string} walletAddress - Wallet address being processed
   * @param {Position[]} positions - Array of position objects
   * @param {Object} loadingMessage - Loading message to replace or reference
   * @returns {Promise<void>}
   */
  async processPositions(chatId, walletAddress, positions, loadingMessage) {
    if (positions.length === 0) {
      await this.bot.send(new NoPositionsMessage(chatId, loadingMessage.id));
      return;
    }

    for (let i = 0; i < positions.length; i++) {
      const position = positions[i];
      const positionMessage = new PositionMessage(position);
      positionMessage.chatId = chatId;

      // Replace loading message with first position, send new messages for others
      if (i === 0) {
        positionMessage.id = loadingMessage.id;
      }

      const sentMessage = await this.bot.send(positionMessage);
      this.positionMessages.set(position.tokenId, sentMessage);

      await this.savePositionData(position, walletAddress, chatId, sentMessage.id);
      this.startMonitoringPosition(position.tokenId);
    }
  }

  /**
   * Saves position data to the database for persistence
   * @param {Position} position - Position object to save
   * @param {string} walletAddress - Wallet address owning the position
   * @param {string} chatId - Telegram chat ID
   * @param {string} messageId - Message ID of the position message
   * @returns {Promise<void>}
   */
  async savePositionData(position, walletAddress, chatId, messageId) {
    try {
      await this.db.savePosition({
        ...position.toObject(),
        walletAddress,
        poolAddress: position.pool.address,
        chatId,
        messageId,
        isMonitored: true
      });
    } catch (error) {
      console.error(`Error saving position ${position.tokenId}:`, error);
    }
  }

  /**
   * Starts monitoring a position for swap events and price changes
   * @param {string} tokenId - Token ID of the position to monitor
   * @returns {void}
   */
  startMonitoringPosition(tokenId) {
    const message = this.positionMessages.get(tokenId);
    if (!message) {
      console.error(`No position message found for token ID ${tokenId}`);
      return;
    }

    const pool = message.position.pool;
    pool.startMonitoring().then(() => {
      pool.removeListener('swap', this.swapEventListener);
      pool.on('swap', this.swapEventListener);
    }).catch(error => {
      console.error(`Error starting monitoring for position ${tokenId}:`, error);
    });
  }

  /**
   * Handles swap events by updating affected position messages
   * @param {Object} swapInfo - Information about the swap event
   * @param {Object} poolData - Pool data containing address and other details
   * @returns {Promise<void>}
   */
  async onSwap(swapInfo, poolData) {
    const affectedPositions = Array.from(this.positionMessages.values())
      .filter(message => message.position.pool.address === poolData.address);

    for (const message of affectedPositions) {
      try {
        await this.updatePositionMessage(message);

        // Check range notification
        await this.handleRangeNotification(message);
      } catch (error) {
        console.error(`Error updating position ${message.position.tokenId}:`, error);
      }
    }
  }

  /**
   * Handles range notifications by sending alerts when positions go out of range
   * and removing alerts when they come back in range
   * @param {PositionMessage} positionMessage - Position message to check for range changes
   * @returns {Promise<void>}
   */
  async handleRangeNotification(positionMessage) {
    const { position } = positionMessage;
    const tokenId = position.tokenId;
    const hasNotification = this.rangeNotificationMessages.has(tokenId);

    if (!position.inRange && !hasNotification) {
      // Position went out of range - send notification
      // Set a temporary placeholder to prevent race conditions
      this.rangeNotificationMessages.set(tokenId, { sending: true });

      const rangeNotification = new RangeNotificationMessage(
        position,
        positionMessage.chatId,
        positionMessage.id
      );

      try {
        const sentNotification = await this.bot.send(rangeNotification);
        this.rangeNotificationMessages.set(tokenId, sentNotification);
      } catch (error) {
        console.error(`Error sending range notification for position ${tokenId}:`, error);
        // Remove placeholder on error
        this.rangeNotificationMessages.delete(tokenId);
      }
    } else if (position.inRange && hasNotification) {
      const notificationMessage = this.rangeNotificationMessages.get(tokenId);

      // Skip if it's just a placeholder (still sending)
      if (notificationMessage && notificationMessage.sending) {
        return;
      }

      // Position came back in range - delete notification
      try {
        await this.bot.deleteMessage(notificationMessage.chatId, notificationMessage.id);
        this.rangeNotificationMessages.delete(tokenId);
      } catch (error) {
        console.error(`Error deleting range notification for position ${tokenId}:`, error);
      }
    }
  }

  /**
   * Updates a position message with fresh data from the blockchain
   * @param {PositionMessage} message - Position message to update
   * @returns {Promise<void>}
   */
  async updatePositionMessage(message) {
    const { position } = message;

    try {
      // Fetch updated position data
      const updatedData = await Position.fetchPositionDetails(position.tokenId, position.isStaked);
      const updatedPosition = new Position(updatedData);

      // Calculate combined token1 value
      const combinedToken1Value = await updatedPosition.getCombinedToken1Value();
      if (combinedToken1Value < 0.1) {
        console.log(`Position ${position.tokenId} liquidity dropped below 0.1 (${combinedToken1Value.toFixed(4)}). Stopping monitoring.`);

        // Stop monitoring this position
        await this.stopMonitoringPosition(position.tokenId);
        this.positionMessages.delete(position.tokenId);
        await this.db.removePosition(position.tokenId, position.walletAddress);

        return; // Exit early, don't update the message
      }

      updatedPosition.walletAddress = position.walletAddress; // FIXME
      updatedPosition.fees = await message.position.fetchAccumulatedFees();
      message.position = updatedPosition;

      await this.bot.send(message);

      await this.db.savePosition({
        ...updatedPosition.toObject(),
        walletAddress: updatedPosition.walletAddress,
        poolAddress: updatedPosition.pool.address,
        chatId: message.chatId,
        messageId: message.id,
        isMonitored: true
      });
    } catch (error) {
      console.error(`Error updating position message for ${position.tokenId}:`, error);
      throw error;
    }
  }

  /**
   * Stops monitoring a position and cleans up related resources
   * @param {string} tokenId - Token ID of the position to stop monitoring
   * @returns {Promise<void>}
   */
  async stopMonitoringPosition(tokenId) {
    const message = this.positionMessages.get(tokenId);
    if (!message) {
      console.warn(`No position message found for token ID ${tokenId} to stop monitoring`);
      return;
    }

    try {
      // Stop pool monitoring if this was the last position for this pool
      const pool = message.position.pool;
      const otherPositionsForPool = Array.from(this.positionMessages.values())
        .filter(msg => msg.position.pool.address === pool.address && msg.position.tokenId !== tokenId);

      if (otherPositionsForPool.length === 0) {
        pool.removeListener('swap', this.swapEventListener);
        console.log(`Stopped monitoring pool ${pool.address} as no more positions are being tracked`);
      }
    } catch (error) {
      console.error(`Error stopping monitoring for position ${tokenId}:`, error);
    }
  }

  /**
   * Restores monitoring for all previously monitored positions on startup
   * @returns {Promise<void>}
   */
  async restoreMonitoredPositions() {
    try {
      console.log('Restoring monitored positions...');
      const wallets = this.walletService.getAllMonitoredWallets();
      let restoredCount = 0;

      for (const walletAddress of wallets) {
        try {
          const positions = await this.db.getPositionsByWallet(walletAddress);

          for (const positionData of positions) {
            if (positionData.messageId && positionData.chatId) {
              await this.restorePosition(positionData);
              restoredCount++;
            }
          }
        } catch (error) {
          console.error(`Error restoring positions for wallet ${walletAddress}:`, error);
        }
      }

      console.log(`Restored monitoring for ${restoredCount} positions`);
    } catch (error) {
      console.error('Error restoring monitored positions:', error);
    }
  }

  /**
   * Restores monitoring for a single position from stored data
   * @param {Object} positionData - Stored position data from database
   * @returns {Promise<void>}
   */
  async restorePosition(positionData) {
    try {
      // Fetch full position details from blockchain
      const fullPositionData = await Position.fetchPositionDetails(
        positionData.tokenId,
        positionData.isStaked || false, // Use the stored isStaked value
        positionData.walletAddress
      );

      // Create Position object with full data
      const position = new Position(fullPositionData);
      position.walletAddress = positionData.walletAddress; // Ensure wallet address is set

      const positionMessage = new PositionMessage(position);
      positionMessage.chatId = positionData.chatId;
      positionMessage.id = positionData.messageId;

      this.positionMessages.set(positionData.tokenId, positionMessage);
      this.startMonitoringPosition(positionData.tokenId);

      console.log(`Restored position ${positionData.tokenId} for wallet ${positionData.walletAddress}`);
    } catch (error) {
      console.error(`Error restoring position ${positionData.tokenId}:`, error);
      // Don't throw the error to prevent stopping the restoration of other positions
    }
  }

  /**
   * Returns help text for the /lp command
   * @returns {string} Help text describing the command functionality
   */
  static help() {
    return "/lp - List current liquidity pools for monitored wallets";
  }
}

module.exports = { LpHandler, PositionMessage };

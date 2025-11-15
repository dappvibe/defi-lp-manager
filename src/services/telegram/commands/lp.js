const Position = require('../../uniswap/position');
const TelegramMessage = require("../message");
const { getTimeInTimezone, moneyFormat } = require('../../../utils');
const AbstractHandler = require("../handler");

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
  constructor(position, pool) {
    super();
    this.position = position;
    this.pool = pool;
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

    const header = `${rangeIcon} $${moneyFormat(this.pool.price)}`;

    // Build fees line with CAKE rewards and calculate APY
    let feesLine = '';
    let apyDisplay = '';

    if (position.fees) {
      feesLine = `💸 $${moneyFormat(position.fees.totalValue)}`;
      if (position.fees.cakeRewards) {
        feesLine += ` 🍪 $${moneyFormat(position.fees.cakeRewards.value)}`;
      }

      // Calculate real-time APY if position has createdAt and we have total fees/rewards
      if (position.createdAt && position.fees.totalValue > 0) {
        const now = new Date();
        const created = new Date(position.createdAt);
        const ageInMs = now - created;
        const ageInSeconds = ageInMs / 1000;

        if (ageInSeconds > 0) {
          // Calculate total position value (token amounts in USD)
          const token0Value = parseFloat(position.token0Amount) * this.pool.price;
          const token1Value = parseFloat(position.token1Amount);
          const totalPositionValue = token0Value + token1Value;

          if (totalPositionValue > 0) {
            // Total profit = fees + CAKE rewards
            const totalProfit = position.fees.totalValue + (position.fees.cakeRewards?.value || 0);

            // Calculate per-second return rate
            const secondlyReturn = totalProfit / totalPositionValue / ageInSeconds;

            // Annualize (31,536,000 seconds per year) and convert to percentage
            const apy = secondlyReturn * 31536000 * 100;

            apyDisplay = ` 📈 ${apy.toFixed(1)}%`;
          }
        }
      }

      feesLine += `\n`;
    }

    const amounts = `💰 ${parseFloat(position.token0Amount).toFixed(4)} ${position.token0.symbol} + ${moneyFormat(parseFloat(position.token1Amount))} ${position.token1.symbol}`;

    // Calculate position age with APY
    let timeWithAge = `⏰ ${timestamp}`;
    if (position.createdAt) {
      const now = new Date();
      const created = new Date(position.createdAt);
      const ageMs = now - created;
      const ageMinutes = Math.floor(ageMs / (1000 * 60));
      const hours = Math.floor(ageMinutes / 60);
      const minutes = ageMinutes % 60;
      const ageDisplay = hours > 0 ? `${hours}:${minutes.toString().padStart(2, '0')}` : `0:${minutes.toString().padStart(2, '0')}`;
      timeWithAge = `⏰ ${timestamp} ⏳ ${ageDisplay}${apyDisplay}`;
    }

    const stakingStatus = position.isStaked ? '🥩 STAKED' : '💼 UNSTAKED';
    const priceRange = `${stakingStatus} | $${moneyFormat(parseFloat(position.lowerPrice))} - $${moneyFormat(parseFloat(position.upperPrice))}`;
    const poolInfo = `${position.token0.symbol}/${position.token1.symbol} (${feePercent}%) - [#${position.tokenId}](${positionLink})`;

    return `${header}\n${feesLine}${timeWithAge}\n${amounts}\n${priceRange}\n${poolInfo}`;
  }

  get options() {
    return { parse_mode: 'Markdown', disable_web_page_preview: true };
  }
}

/**
 * Handler for /lp command - Lists liquidity positions for monitored wallets
 */
class LpHandler extends AbstractHandler {
  /**
   * Creates an instance of LpHandler
   * @param UserModel
   * @param messageModel
   * @param PositionModel
   * @param WalletModel
   * @param positionFactory
   * @param poolFactoryContract
   */
  constructor(UserModel, messageModel, PositionModel, WalletModel, positionFactory, poolFactoryContract) {
    super(UserModel);
    this.messageModel = messageModel;
    this.positionModel = PositionModel;
    this.WalletModel = WalletModel;
    this.positionFactory = positionFactory;
    this.poolFactory = poolFactoryContract;
    this.positionMessages = new Map(); // tokenId => PositionMessage
    this.rangeNotificationMessages = new Map(); // tokenId => RangeNotificationMessage
    this.swapEventListener = (swapInfo, poolData) => this.onSwap(swapInfo, poolData);

    // Start restoration process asynchronously
    // this.restoreMonitoredPositions().catch(error => {
    //   console.error('Error during position monitoring restoration:', error);
    // });
  }

  /**
   * Registers bot command handlers for the /lp command
   * @returns {this}
   */
  listenOn(bot) {
    this.bot = bot;
    this.bot.onText(/\/lp/, this.handleCommand.bind(this));
    return this;
  }

  /**
   * Handles the /lp command by processing monitored wallets and their positions
   * @param {Object} msg - Telegram message object
   * @returns {Promise<void>}
   */
  async handleCommand(msg) {
    const chatId = msg.chat.id;

    const user = await this.getUser(msg);
    const wallets = user.getWallets('arbitrum');

    if (wallets.length === 0) {
      return this.bot.send("💼 No wallets are being monitored.\n\nUse /wallet to start monitoring a wallet.", chatId);
    }

    for (let i = 0; i < wallets.length; i++) {
      const address = wallets[i];
      this.bot.sendChatAction(chatId, 'typing');
      const typing = setInterval(() => this.bot.sendChatAction(chatId, 'typing'), 5000);

      try {
        let positionsFound = false;
        for await (const position of this.positionFactory.fetchPositions(address)) {
          positionsFound = true;
          if (!position.isEmpty()) {
            //await position.fetchPositionDetails();
            await this.processPosition(chatId, address, position);
          }
        }

        if (!positionsFound) {
          await this.bot.send(new NoPositionsMessage(chatId));
        }
      }
      finally {
        clearInterval(typing);
      }
    }
  }

  /**
   * Processes a single position, sending a message and starting monitoring
   * @param {string} chatId - Telegram chat ID
   * @param {string} walletAddress - Wallet address being processed
   * @param {Position} position - Position object to process
   * @returns {Promise<void>}
   */
  async processPosition(chatId, walletAddress, position) {
    /*const existingPosition = await this.db.getPosition(position.tokenId, walletAddress);
    if (existingPosition && existingPosition.createdAt) {
      position.createdAt = existingPosition.createdAt;
    }*/

    const pool = await this.poolFactory.getForPosition(position);

    //pool.fetchPosition(position); // load current prices and liquidity

    const positionMessage = new PositionMessage(position, await pool.slot0());
    positionMessage.chatId = chatId;

    const sentMessage = await this.bot.send(positionMessage);
    this.positionMessages.set(position.id, sentMessage);

    //await this.savePositionData(position, walletAddress, chatId, sentMessage.id);
    //this.startMonitoringPosition(position.tokenId);
  }

  /**
   * Saves position data to the database for persistence
   * @param {Position} position - Position object to save
      const positionData = {
        ...position.toObject(),
        walletAddress,
        poolAddress: position.pool.address,
        chatId,
        messageId,
        isMonitored: true
      };

      // Only set createdAt if it's not already set (for new positions)
      if (!position.createdAt) {
        positionData.createdAt = new Date();
      } else {
        positionData.createdAt = position.createdAt;
      }

      await this.db.savePosition(positionData);
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
        this.rangeNotificationMessages.delete(tokenId);
        await this.bot.deleteMessage(notificationMessage.chatId, notificationMessage.id);
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

        // send last update reflecting 0 liquidity
        message.position = updatedPosition;
        await this.bot.send(message);

        // Stop monitoring this position
        await this.stopMonitoringPosition(position.tokenId);
        this.positionMessages.delete(position.tokenId);
        await this.db.removePosition(position.tokenId, position.walletAddress);

        return; // Exit early, don't update the message
      }

      updatedPosition.walletAddress = position.walletAddress; // FIXME
      updatedPosition.createdAt = position.createdAt; // Preserve createdAt
      updatedPosition.fees = await message.position.fetchAccumulatedFees();
      message.position = updatedPosition;

      await this.bot.send(message);

      await this.db.savePosition({
        ...updatedPosition.toObject(),
        walletAddress: updatedPosition.walletAddress,
        poolAddress: updatedPosition.pool.address,
        chatId: message.chatId,
        messageId: message.id,
        isMonitored: true,
        createdAt: updatedPosition.createdAt
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
      const wallets = this.WalletModel.getAllMonitoredWallets();
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
      position.createdAt = positionData.createdAt; // Preserve original creation time

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

  getMyCommand = () => ['lp', 'List active liquidity pools for your wallets']
}

module.exports = LpHandler

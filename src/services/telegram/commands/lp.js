const Position = require('../../uniswap/position');
const TelegramMessage = require("../message");
const { getTimeInTimezone, moneyFormat } = require('../../../utils');
const AbstractHandler = require("../handler");

class NoPositionsMessage extends TelegramMessage {
  constructor(chatId, wallets) {
    super();
    this.chatId = chatId;
    this.wallets = wallets;
  }

  toString() {
    return `No active positions found in ${this.wallets.length} wallets.`;
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
  constructor(position, value, fees, amounts, prices) {
    super();
    this.position = position;
    this.value = value;
    this.fees = fees;
    this.amounts = amounts;
    this.prices = prices;
  }

  toString() {
    const p = this.position;
    const lines = [];

    // Pool price
    lines.push(p.inRange ? '🟢' : '🔴' + ` $${moneyFormat(this.prices.current)}`);

    // Accumulated fees and CAKE rewards
    let feesLine = '';
    feesLine = `💸 $${moneyFormat(this.fees.totalValue)}`;
    feesLine += ` 🍪 $${moneyFormat(this.fees.rewards.value)}`;
    lines.push(feesLine);

    // last update, age, APY
    let timeLine = '⏰ ' + getTimeInTimezone(); // current time to show in UI that it is being updated
    const age = Math.round((new Date() - p.createdAt) / 1000); // seconds
    const hours = Math.floor(age / 3600);
    const minutes = Math.floor(age / 60) % 60;
    timeLine += ' ⏳ ' + `${hours}:${minutes.toString().padStart(2, '0')}`;
    const secondlyReturn = (this.fees.totalValue + this.fees.rewards.value) / this.value / age;
    const apy = secondlyReturn * 31536000 * 100; // Annualize (31,536,000 seconds per year) and convert to percentage
    timeLine += ` 📈 ${apy.toFixed(2)}%`;
    lines.push(timeLine);

    // token amounts
    let amounts = `💰 ${this.amounts[0].toFixed(6)} ${p.pool.token0.symbol} + `;
    amounts += `${moneyFormat(this.amounts[1])} ${p.pool.token1.symbol}`;
    lines.push(amounts);

    // Staking status and price range
    let rangeLine = p.isStaked ? '🥩 STAKED' : '💼 UNSTAKED';
    rangeLine += ` | $${moneyFormat(this.prices.lower)} - $${moneyFormat(this.prices.upper)}`;
    lines.push(rangeLine);

    // pool pair and tokenId
    const feePercent = (p.pool.fee / 10000).toFixed(2);
    const posLink = `https://pancakeswap.finance/liquidity/${p.tokenId}?chain=arb&persistChain=1`;
    const poolLink = `https://pancakeswap.finance/liquidity/pool/arb/` + p.pool.address;
    let poolInfo = `[${p.pool.token0.symbol}/${p.pool.token1.symbol}](${poolLink}) (${feePercent}%)`;
    poolInfo += ` - [#${p.tokenId}](${posLink})`;
    lines.push(poolInfo);

    return lines.join('\n');
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
   * @param MessageModel
   * @param PositionModel
   * @param WalletModel
   * @param positionFactory
   * @param PoolModel
   */
  constructor(UserModel, MessageModel, PositionModel, WalletModel, positionFactory, PoolModel) {
    super(UserModel);
    this.MessageModel = MessageModel;
    this.positionModel = PositionModel;
    this.WalletModel = WalletModel;
    this.positionFactory = positionFactory;
    this.positionMessages = new Map(); // tokenId => PositionMessage
    this.rangeNotificationMessages = new Map(); // tokenId => RangeNotificationMessage
    this.swapEventListener = (swapInfo, poolData) => this.onSwap(swapInfo, poolData);
    this.PoolModel = PoolModel;
    this.cakePrice = 0;

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
    await user.populate('wallets');

    if (user.wallets.length === 0) {
      return this.bot.send("💼 No wallets are being monitored.\n\nUse /wallet to start monitoring a wallet.", chatId);
    }

    // CAKE/USDC FIXME somehow in container so that it's chainId aware
    const cakePool = await this.PoolModel.fetch(
      '0x1b896893dfc86bb67cf57767298b9073d2c1ba2c',
      '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
      2500
    );
    this.cakePrice = await cakePool.getPrices();
    this.cakePrice = this.cakePrice.current;

    for (let i = 0; i < user.wallets.length; i++) {
      const wallet = user.wallets[i];

      this.bot.sendChatAction(chatId, 'typing').then();
      const typing = setInterval(() => this.bot.sendChatAction(chatId, 'typing'), 5000);

      try {
        let positionsFound = false;
        for await (const position of this.positionFactory.fetchPositions(wallet.address)) {
          if (!await position.isEmpty()) {
            positionsFound = true;
            const sent = await this.outputPosition(chatId, wallet, position);

            // Save message to keep updating after restart
            this.MessageModel.findOneAndUpdate(
              {type: 'Position_' + position.tokenId, chatId},
              {
                chatId,
                messageId: sent.id,
                type: 'Position_' + position.tokenId,
                metadata: sent
              },
              {upsert: true, new: true, setDefaultsOnInsert: true}
            ).then(doc => this.positionMessages.set(position._id, doc));
          }
        }

        if (!positionsFound) this.bot.send(new NoPositionsMessage(chatId, user.wallets)).then();
      }
      finally {
        // FIXME typing is cleared after first message and then inconsistently shown
        clearInterval(typing);
      }
    }
  }

  /**
   * Processes a single position, sending a message and starting monitoring
   * @param {string} chatId - Telegram chat ID
   * @param {WalletModel} wallet - Wallet address being processed
   * @param {PositionModel} position - Position object to process
   * @returns {Promise<void>}
   */
  async outputPosition(chatId, wallet, position) {
    const [value, prices, fees, amounts] = await Promise.all([
      position.calculateCombinedValue(),
      position.pool.getPrices(position),
      position.calculateUnclaimedFees(),
      position.calculateTokenAmounts()
    ]);
    fees.rewards.value = fees.rewards.amount * this.cakePrice;

    const positionMessage = new PositionMessage(position, value, fees, amounts, prices);
    positionMessage.chatId = chatId;

    return await this.bot.send(positionMessage);
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

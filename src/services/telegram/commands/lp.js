const Position = require('../../uniswap/position');
const TelegramMessage = require("../message");
const { getTimeInTimezone } = require('../../../utils/time');

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
    const poolLink = `https://pancakeswap.finance/liquidity/${position.tokenId}?chain=arb&persistChain=1`;

    // Format components
    const header = `**${position.token0Symbol}/${position.token1Symbol}** (${feePercent}%) - [#${position.tokenId}](${poolLink})`;
    const amounts = `💰 ${parseFloat(position.token0Amount).toFixed(4)} ${position.token0Symbol} + ${parseFloat(position.token1Amount).toFixed(2)} ${position.token1Symbol}`;
    const priceRange = `📊 **$${parseFloat(position.currentPrice).toFixed(2)}** - $${parseFloat(position.lowerPrice).toFixed(2)} - $${parseFloat(position.upperPrice).toFixed(2)}`;

    const stakingStatus = position.isStaked ? '🥩 STAKED' : '💼 UNSTAKED';
    const rangeStatus = position.inRange ? '🟢 IN RANGE' : '🔴 OUT OF RANGE';
    const status = `${stakingStatus} | ${rangeStatus}`;

    const timestamp = `🕐 Updated: ${getTimeInTimezone()}`;

    return `${header}\n${amounts}\n${priceRange}\n${status}\n${timestamp}`;
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
  constructor(bot, mongoose, walletService) {
    this.bot = bot;
    this.mongoose = mongoose;
    this.walletService = walletService;
    this.positionMessages = new Map(); // tokenId => PositionMessage
    this.swapEventListener = (swapInfo, poolData) => this.onSwap(swapInfo, poolData);

    this.registerHandlers();
    // Start restoration process asynchronously
    this.restoreMonitoredPositions().catch(error => {
      console.error('Error during position monitoring restoration:', error);
    });
  }

  registerHandlers() {
    this.bot.onText(/\/lp/, (msg) => this.handleCommand(msg));
  }

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

  async savePositionData(position, walletAddress, chatId, messageId) {
    try {
      await this.mongoose.savePosition({
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

  async onSwap(swapInfo, poolData) {
    const affectedPositions = Array.from(this.positionMessages.values())
      .filter(message => message.position.pool.address === poolData.address);

    for (const message of affectedPositions) {
      try {
        await this.updatePositionMessage(message);
      } catch (error) {
        console.error(`Error updating position ${message.position.tokenId}:`, error);
      }
    }
  }

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
        await this.mongoose.removePosition(position.tokenId, position.walletAddress);

        return; // Exit early, don't update the message
      }

      updatedPosition.walletAddress = position.walletAddress; // FIXME
      message.position = updatedPosition;

      await this.bot.send(message);

      await this.mongoose.savePosition({
        ...position.toObject(),
        walletAddress: position.walletAddress,
        poolAddress: position.pool.address,
        chatId: message.chatId,
        messageId: message.id,
        isMonitored: true
      });
    } catch (error) {
      console.error(`Error updating position message for ${position.tokenId}:`, error);
      throw error;
    }
  }

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

  async restoreMonitoredPositions() {
    try {
      console.log('Restoring monitored positions...');
      const wallets = this.walletService.getAllMonitoredWallets();
      let restoredCount = 0;

      for (const walletAddress of wallets) {
        try {
          const positions = await this.mongoose.getPositionsByWallet(walletAddress);

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

  async restorePosition(positionData) {
    try {
      // Fetch full position details from blockchain
      const fullPositionData = await Position.fetchPositionDetails(
        positionData.tokenId,
        false, // Assume not staked initially, will be updated if needed
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

  static help() {
    return "/lp - List current liquidity pools for monitored wallets";
  }
}

module.exports = { LpHandler, PositionMessage };

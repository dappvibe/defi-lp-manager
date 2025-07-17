const Position = require('../../uniswap/position');
const { getPool } = require('../../uniswap/pool');
const TelegramMessage = require("../message");

/**
 * Represents a no wallets message
 */
class NoWalletsMessage extends TelegramMessage {
  constructor(chatId) {
    super();
    this.chatId = chatId;
  }

  /**
   * Get the formatted message content
   * @returns {string} The no wallets message
   */
  toString() {
    return "💼 No wallets are currently being monitored.\n\nUse /wallet <address> to start monitoring a wallet.";
  }
}

/**
 * Represents a loading message for a wallet
 */
class WalletLoadingMessage extends TelegramMessage {
  /**
   * Create a wallet loading message instance
   * @param {number} chatId - Chat ID
   * @param {number} walletIndex - Index of the wallet being processed
   * @param {string} walletAddress - Wallet address
   */
  constructor(chatId, walletIndex, walletAddress) {
    super();
    this.chatId = chatId;
    this.walletIndex = walletIndex;
    this.walletAddress = walletAddress;
  }

  /**
   * Get the formatted message content
   * @returns {string} The loading message
   */
  toString() {
    return `💼 **Wallet ${this.walletIndex + 1}:** \`${this.walletAddress}\`\n⏳ Loading positions...`;
  }

  getOptions() {
    return { parse_mode: 'Markdown' };
  }
}

/**
 * Represents a no positions message
 */
class NoPositionsMessage extends TelegramMessage {
  constructor(chatId, messageId) {
    super();
    this.chatId = chatId;
    this.id = messageId;
  }

  /**
   * Get the formatted message content
   * @returns {string} The no positions message
   */
  toString() {
    return "No active positions found in this wallet.";
  }

  getOptions() {
    return {
      parse_mode: 'Markdown',
      disable_web_page_preview: true
    };
  }
}

/**
 * Represents a position error message
 */
class PositionErrorMessage extends TelegramMessage {
  /**
   * Create a position error message instance
   * @param {number} chatId - Chat ID
   * @param {number} messageId - Message ID (optional for edit)
   * @param {number} positionIndex - Index of the position
   * @param {string} error - Error message
   */
  constructor(chatId, messageId, positionIndex, error) {
    super();
    this.chatId = chatId;
    this.id = messageId;
    this.positionIndex = positionIndex;
    this.error = error;
  }

  /**
   * Get the formatted message content
   * @returns {string} The error message
   */
  toString() {
    return `❌ **Position #${this.positionIndex + 1}:** Error - ${this.error}`;
  }

  getOptions() {
    return {
      parse_mode: 'Markdown',
      disable_web_page_preview: true
    };
  }
}

/**
 * Represents a position message
 */
class PositionMessage extends TelegramMessage {
  /**
   * Create a position message instance
   * @param {Object} position - Position object
   * @param {boolean} isUpdate - Whether this is an update message
   */
  constructor(position, isUpdate = false) {
    super();
    this.position = position;
    this.isUpdate = isUpdate;
  }

  /**
   * Get the formatted message content
   * @returns {string} The position message
   */
  toString() {
    if (!this.position || this.position.error) {
      return `❌ Error loading position: ${this.position?.error || 'Unknown error'}`;
    }

    // Format fee percentage
    const feePercent = (this.position.fee / 10000).toFixed(2);

    // Create pool link (PancakeSwap format)
    const poolLink = `https://pancakeswap.finance/liquidity/${this.position.tokenId}?chain=arb&persistChain=1`;

    // Format token pair with link
    const tokenPairLine = `**${this.position.token0Symbol}/${this.position.token1Symbol}** (${feePercent}%) - [#${this.position.tokenId}](${poolLink})`;

    // Format token amounts
    const amountsLine = `💰 ${parseFloat(this.position.token0Amount).toFixed(4)} ${this.position.token0Symbol} + ${parseFloat(this.position.token1Amount).toFixed(2)} ${this.position.token1Symbol}`;

    // Format price and range
    const priceRangeLine = `📊 **$${parseFloat(this.position.currentPrice).toFixed(2)}** - $${parseFloat(this.position.lowerPrice).toFixed(2)} - $${parseFloat(this.position.upperPrice).toFixed(2)}`;

    // Format status
    const stakingStatus = this.position.isStaked ? '🥩 STAKED' : '💼 UNSTAKED';
    const rangeStatus = this.position.inRange ? '🟢 IN RANGE' : '🔴 OUT OF RANGE';
    const statusLine = `${stakingStatus} | ${rangeStatus}`;

    // Build the message
    let message = `${tokenPairLine}\n${amountsLine}\n${priceRangeLine}\n${statusLine}`;

    // Add timestamp if this is an update
    if (this.isUpdate) {
      const { getTimeInTimezone } = require('../../../utils/time');
      message += `\n🕐 Updated: ${getTimeInTimezone()}`;
    }

    return message;
  }

  getOptions() {
    return {
      parse_mode: 'Markdown',
      disable_web_page_preview: true
    };
  }
}

/**
 * Represents a general error message
 */
class GeneralErrorMessage extends TelegramMessage {
  /**
   * Create a general error message instance
   * @param {number} chatId - Chat ID
   * @param {string} error - Error message
   */
  constructor(chatId, error) {
    super();
    this.chatId = chatId;
    this.error = error;
  }

  /**
   * Get the formatted message content
   * @returns {string} The error message
   */
  toString() {
    return `❌ Error fetching liquidity positions: ${this.error}`;
  }
}

/**
 * Handler for /lp command
 * Lists current liquidity pools for monitored wallet along with information about pool,
 * human readable, token amounts, price ranges in token 1 relative to token 0
 */
class LpHandler {
  /**
   * Create a new LpHandler instance
   * @param {TelegramBot} bot - The bot instance
   * @param mongo
   * @param {object} walletService - Wallet service instance
   */
  constructor(bot, mongo, walletService) {
    this.bot = bot;
    this.mongo = mongo;
    this.walletService = walletService;

    /**
     * Store for tracking active position monitors by pool address
     * @type {Map<string, Set<Object>>} Map of poolAddress -> Set of {tokenId, chatId, messageId}
     */
    this.positions = new Map();

    /**
     * Store event listener reference for cleanup
     * @type {Function|null}
     */
    this.swapEventListener = (swapInfo, poolData) => {
      this.onSwap(swapInfo, poolData);
    };

    // Register handlers on instantiation
    this.registerHandlers();
  }

  /**
   * Register command handlers with the bot
   */
  registerHandlers() {
    this.bot.onText(/\/lp/, (msg) => {
      this.handle(msg);
    });
  }

  /**
   * Handle lp command
   * @param {Object} msg - Message object from Telegram
   */
  async handle(msg) {
    const chatId = msg.chat.id;

    // Get monitored wallets
    const monitoredWallets = this.walletService.getWalletsForChat(chatId);

    if (monitoredWallets.length === 0) {
      const noWalletsMessage = new NoWalletsMessage(chatId);
      await this.bot.send(noWalletsMessage);
      return;
    }

    try {
      // Process each wallet
      for (let walletIndex = 0; walletIndex < monitoredWallets.length; walletIndex++) {
        const walletAddress = monitoredWallets[walletIndex];

        // Send initial wallet message with loading status
        const loadingMessage = new WalletLoadingMessage(chatId, walletIndex, walletAddress);
        const loadingMessageSent = await this.bot.send(loadingMessage);

        // Get positions for this wallet
        const positions = await Position.fetchPositions(walletAddress);

        if (positions.length === 0) {
          // Replace loading message with "no positions" message
          const noPositionsMessage = new NoPositionsMessage(chatId, loadingMessageSent.id);
          await this.bot.send(noPositionsMessage);
        } else {
          // Process each position
          for (let positionIndex = 0; positionIndex < positions.length; positionIndex++) {
            const position = positions[positionIndex];

            if (position.error) {
              const errorMessage = new PositionErrorMessage(chatId,
                positionIndex === 0 ? loadingMessageSent.id : null,
                positionIndex,
                position.error);

              await this.bot.send(errorMessage);
              continue;
            }

            // Create position message
            const positionMessage = new PositionMessage(position, false);
            positionMessage.chatId = chatId;

            let sentMessage;
            if (positionIndex === 0) {
              // Replace loading message with first position
              positionMessage.id = loadingMessageSent.id;
              sentMessage = await this.bot.send(positionMessage);
            } else {
              // Send additional positions as separate messages
              sentMessage = await this.bot.send(positionMessage);
            }

            // Save position to MongoDB with message ID
            try {
              const positionData = {
                ...position,
                walletAddress: walletAddress,
                poolAddress: position.poolAddress
              };
              await this.mongo.savePosition(position);

              // Register position for event monitoring if it's in range
              if (position.inRange && position.poolAddress) {
                await this.registerPositionForEventMonitoring(position.poolAddress, position.tokenId, chatId, sentMessage.id);
              }
            } catch (saveError) {
              console.error(`Error saving position ${position.tokenId} from /lp command:`, saveError);
            }
          }
        }
      }

    } catch (error) {
      console.error('Error fetching liquidity positions:', error);
      const generalErrorMessage = new GeneralErrorMessage(chatId, error.message);
      await this.bot.send(generalErrorMessage);
    }
  }

  /**
   * Handle swap event from PoolService
   * @param {Object} swapInfo - Swap information
   * @param {Object} poolData - Pool data
   */
  async onSwap(swapInfo, poolData) {
    const { poolAddress, newPrice, timestamp } = swapInfo;
    const activePositions = this.positions.get(poolAddress);

    if (!activePositions || activePositions.size === 0) {
      return; // No active positions for this pool
    }

    try {
      // Process each active position for this pool
      for (const positionData of activePositions) {
        try {
          // Get fresh position details with updated token amounts
          const updatedPositionData = await Position.fetchPositionDetails(BigInt(positionData.tokenId), false);
          const updatedPosition = new Position(updatedPositionData);

          if (updatedPosition.error) {
            console.warn(`Error getting updated position details for token ID ${positionData.tokenId}:`, updatedPosition.error);
            continue;
          }

          // Check if position is still in range
          if (!updatedPosition.inRange) {
            // Position went out of range, remove from active positions
            activePositions.delete(positionData);
            console.log(`Position ${positionData.tokenId} went out of range, removed from active monitoring`);
            continue;
          }

          // Create updated position message
          const positionMessage = new PositionMessage(updatedPosition, true);
          positionMessage.chatId = positionData.chatId;
          positionMessage.id = positionData.messageId;

          // Update the message in Telegram
          await this.bot.send(positionMessage);

          // Update position data in MongoDB
          await this.mongo.savePosition(
              positionData.tokenId,
              updatedPosition.walletAddress || 'unknown',
              positionData.chatId,
              {
                token0Amount: updatedPosition.token0Amount,
                token1Amount: updatedPosition.token1Amount,
                currentPrice: updatedPosition.currentPrice,
                inRange: updatedPosition.inRange,
                liquidity: updatedPosition.liquidity?.toString()
              }
          );

          console.log(`Updated position message for token ID ${positionData.tokenId} in chat ${positionData.chatId} via swap event`);

        } catch (error) {
          console.error(`Error updating position message for token ID ${positionData.tokenId}:`, error.message);
        }
      }

      // Remove the pool from active positions if no positions remain
      if (activePositions.size === 0) {
        this.positions.delete(poolAddress);
        console.log(`Removed pool ${poolAddress} from active positions - no more positions in range`);
      }

      await this.mongo.close();

    } catch (error) {
      console.error(`Error handling swap event for LP positions in pool ${poolAddress}:`, error.message);
    }
  }

  /**
   * Initialize event listener for swap events from PoolService
   */
  initializeSwapEventListener() {
    return;
    if (this.swapEventListener) {
      Pool.removeListener('swap', this.swapEventListener);
    }

    Pool.on('swap', this.swapEventListener);
    console.log('Initialized swap event listener for LP command');
  }

  /**
   * Register a position for event monitoring when pool swaps occur
   * @param {string} poolAddress - Pool address
   * @param {string} tokenId - Position token ID
   * @param {number} chatId - Chat ID
   * @param {number} messageId - Message ID
   */
  async registerPositionForEventMonitoring(poolAddress, tokenId, chatId, messageId) {
    try {
      // Create or get the position set for this pool
      if (!this.positions.has(poolAddress)) {
        this.positions.set(poolAddress, new Set());
      }

      // Add this position to the active positions set
      const positionSet = this.positions.get(poolAddress);
      const positionData = {
        tokenId: tokenId,
        chatId: chatId,
        messageId: messageId
      };

      positionSet.add(positionData);

      console.log(`Registered position for event monitoring: pool ${poolAddress}, tokenId ${tokenId}, chat ${chatId}`);
    } catch (error) {
      console.error(`Error registering position for event monitoring for pool ${poolAddress}:`, error.message);
    }
  }

  /**
   * Unregister a position from event monitoring
   * @param {string} poolAddress - Pool address
   * @param {string} tokenId - Position token ID
   * @param {number} chatId - Chat ID
   */
  unregisterPositionFromEventMonitoring(poolAddress, tokenId, chatId) {
    const positions = this.positions.get(poolAddress);
    if (positions) {
      // Find and remove the position
      for (const position of positions) {
        if (position.tokenId === tokenId && position.chatId === chatId) {
          positions.delete(position);
          console.log(`Unregistered position from event monitoring: pool ${poolAddress}, tokenId ${tokenId}, chat ${chatId}`);
          break;
        }
      }

      // If no more positions for this pool, remove the pool entirely
      if (positions.size === 0) {
        this.positions.delete(poolAddress);
        console.log(`Removed pool ${poolAddress} from active positions - no more positions tracking`);
      }
    }
  }

  /**
   * Update a specific position message
   * @param {number} chatId - Chat ID
   * @param {number} messageId - Message ID
   * @param {Object} position - Updated position data
   */
  async updatePositionMessage(chatId, messageId, position) {
    try {
      const positionMessage = new PositionMessage(position, true);
      positionMessage.chatId = chatId;
      positionMessage.id = messageId;

      await this.bot.send(positionMessage);

      console.log(`Updated individual position message for token ID ${position.tokenId} in chat ${chatId}`);
    } catch (error) {
      console.error(`Error updating individual position message:`, error.message);
    }
  }

  /**
   * Clean up positions for a specific chat (e.g., when user stops monitoring)
   * @param {number} chatId - Chat ID to clean up
   */
  cleanupPositionsForChat(chatId) {
    for (const [poolAddress, positions] of this.positions.entries()) {
      const toRemove = [];

      for (const position of positions) {
        if (position.chatId === chatId) {
          toRemove.push(position);
        }
      }

      // Remove positions for this chat
      for (const position of toRemove) {
        positions.delete(position);
        console.log(`Removed position for chat ${chatId}, pool ${poolAddress}, tokenId ${position.tokenId}`);
      }

      // If no more positions for this pool, remove the pool entirely
      if (positions.size === 0) {
        this.positions.delete(poolAddress);
        console.log(`Removed pool ${poolAddress} from active positions - no more positions tracking`);
      }
    }
  }

  /**
   * Get all active positions (for debugging)
   * @returns {Map} Map of active positions
   */
  getActivePositions() {
    return this.positions;
  }

  /**
   * Clean up event listeners and active positions
   */
  cleanup() {
    if (this.swapEventListener) {
      const poolService = require('../../uniswap/pool');
      poolService.removeListener('swap', this.swapEventListener);
      this.swapEventListener = null;
    }
    this.positions.clear();
    console.log('Cleaned up LP handler resources');
  }

  /**
   * Returns a brief help description with command signature
   * @returns {string} One-line help text
   */
  static help() {
    return "/lp - List current liquidity pools for monitored wallets";
  }
}

module.exports = {
  LpHandler,
  PositionMessage
};

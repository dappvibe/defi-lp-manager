/**
 * Represents a no wallets message
 */
class NoWalletsMessage {
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
class WalletLoadingMessage {
  /**
   * Create a wallet loading message instance
   * @param {number} walletIndex - Index of the wallet being processed
   * @param {string} walletAddress - Wallet address
   */
  constructor(walletIndex, walletAddress) {
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
}

/**
 * Represents a no positions message
 */
class NoPositionsMessage {
  /**
   * Get the formatted message content
   * @returns {string} The no positions message
   */
  toString() {
    return "No active positions found in this wallet.";
  }
}

/**
 * Represents a position error message
 */
class PositionErrorMessage {
  /**
   * Create a position error message instance
   * @param {number} positionIndex - Index of the position
   * @param {string} error - Error message
   */
  constructor(positionIndex, error) {
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
}

/**
 * Represents a position message
 */
class PositionMessage {
  /**
   * Create a position message instance
   * @param {Object} position - Position object
   * @param {boolean} isUpdate - Whether this is an update message
   */
  constructor(position, isUpdate = false) {
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
}

/**
 * Represents a general error message
 */
class GeneralErrorMessage {
  /**
   * Create a general error message instance
   * @param {string} error - Error message
   */
  constructor(error) {
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
   * Store for tracking position callbacks by pool address
   * @type {Map<string, Set<Object>>} Map of poolAddress -> Set of {tokenId, chatId, messageId, callbackId}
   */
  static poolCallbacks = new Map();

  /**
   * Register command handlers with the bot
   * @param {TelegramBot} bot - The bot instance
   * @param {Object} positionMonitor - Position monitor instance
   */
  static onText(bot, positionMonitor) {
    bot.onText(/\/lp/, (msg) => {
      this.handle(bot, msg, positionMonitor);
    });
  }

  /**
   * Handle lp command
   * @param {TelegramBot} bot - The bot instance
   * @param {Object} msg - Message object from Telegram
   * @param {Object} positionMonitor - Position monitor instance
   */
  static async handle(bot, msg, positionMonitor) {
    const chatId = msg.chat.id;

    // Get monitored wallets
    const monitoredWallets = positionMonitor.getMonitoredWallets();

    if (monitoredWallets.length === 0) {
      const noWalletsMessage = new NoWalletsMessage();
      await bot.sendMessage(chatId, noWalletsMessage.toString());
      return;
    }

    try {
      // Process each wallet
      for (let walletIndex = 0; walletIndex < monitoredWallets.length; walletIndex++) {
        const walletAddress = monitoredWallets[walletIndex];

        // Send initial wallet message with loading status
        const loadingMessage = new WalletLoadingMessage(walletIndex, walletAddress);
        const loadingMessageSent = await bot.sendMessage(
            chatId,
            loadingMessage.toString(),
            { parse_mode: 'Markdown' }
        );

        // Get positions for this wallet
        const positions = await positionMonitor.getPositions(walletAddress);

        if (positions.length === 0) {
          // Replace loading message with "no positions" message
          const noPositionsMessage = new NoPositionsMessage();
          await bot.editMessageText(
              noPositionsMessage.toString(),
              {
                chat_id: chatId,
                message_id: loadingMessageSent.message_id,
                parse_mode: 'Markdown',
                disable_web_page_preview: true
              }
          );
        } else {
          // Process each position
          for (let positionIndex = 0; positionIndex < positions.length; positionIndex++) {
            const position = positions[positionIndex];

            if (position.error) {
              const errorMessage = new PositionErrorMessage(positionIndex, position.error);

              if (positionIndex === 0) {
                // Replace loading message with first position error
                await bot.editMessageText(
                    errorMessage.toString(),
                    {
                      chat_id: chatId,
                      message_id: loadingMessageSent.message_id,
                      parse_mode: 'Markdown',
                      disable_web_page_preview: true
                    }
                );
              } else {
                // Send as separate message
                await bot.sendMessage(chatId, errorMessage.toString(), { parse_mode: 'Markdown' });
              }
              continue;
            }

            // Create position message
            const positionMessage = new PositionMessage(position, false);

            let sentMessage;
            if (positionIndex === 0) {
              // Replace loading message with first position
              await bot.editMessageText(
                  positionMessage.toString(),
                  {
                    chat_id: chatId,
                    message_id: loadingMessageSent.message_id,
                    parse_mode: 'Markdown',
                    disable_web_page_preview: true
                  }
              );
              sentMessage = { message_id: loadingMessageSent.message_id };
            } else {
              // Send additional positions as separate messages
              sentMessage = await bot.sendMessage(chatId, positionMessage.toString(), { parse_mode: 'Markdown' });
            }

            // Save position to MongoDB with message ID
            try {
              const poolAddress = await positionMonitor.getPoolAddressForPosition(position);
              const positionData = {
                ...position,
                walletAddress: walletAddress,
                poolAddress: poolAddress
              };
              await positionMonitor.mongoStateManager.savePosition(positionData, chatId, sentMessage.message_id);

              // Register callback for this position's pool if it's in range
              if (position.inRange && poolAddress) {
                await this.registerPositionCallback(bot, poolAddress, position.tokenId, chatId, sentMessage.message_id);
              }
            } catch (saveError) {
              console.error(`Error saving position ${position.tokenId} from /lp command:`, saveError);
            }
          }
        }
      }

    } catch (error) {
      console.error('Error fetching liquidity positions:', error);
      const generalErrorMessage = new GeneralErrorMessage(error.message);
      await bot.sendMessage(chatId, generalErrorMessage.toString());
    }
  }

  /**
   * Register a callback for position updates when pool swaps occur
   * @param {TelegramBot} bot - The bot instance
   * @param {string} poolAddress - Pool address
   * @param {string} tokenId - Position token ID
   * @param {number} chatId - Chat ID
   * @param {number} messageId - Message ID
   */
  static async registerPositionCallback(bot, poolAddress, tokenId, chatId, messageId) {
    try {
      // Import pool service
      const poolService = require('../../uniswap/pool');

      // Create or get the callback set for this pool
      if (!this.poolCallbacks.has(poolAddress)) {
        this.poolCallbacks.set(poolAddress, new Set());
      }

      // Register pool callback with unique ID if this is the first position for this pool
      const callbackSet = this.poolCallbacks.get(poolAddress);
      let callbackId = null;

      if (callbackSet.size === 0) {
        // First position for this pool - register the callback
        callbackId = poolService.registerPoolUpdateCallback(
          poolAddress,
          (updateData) => {
            this.handlePoolUpdate(bot, poolAddress, updateData);
          },
          `lp_handler_${poolAddress}`
        );
      }

      // Add this position to the callback set
      const callbackData = {
        tokenId: tokenId,
        chatId: chatId,
        messageId: messageId,
        callbackId: callbackId // Store the callback ID only for the first position
      };

      callbackSet.add(callbackData);

      console.log(`Registered position callback for pool ${poolAddress}, tokenId ${tokenId}, chat ${chatId}${callbackId ? ` with callback ID: ${callbackId}` : ''}`);
    } catch (error) {
      console.error(`Error registering position callback for pool ${poolAddress}:`, error.message);
    }
  }

  /**
   * Unregister a position callback
   * @param {string} poolAddress - Pool address
   * @param {string} tokenId - Position token ID
   * @param {number} chatId - Chat ID
   */
  static unregisterPositionCallback(poolAddress, tokenId, chatId) {
    const callbacks = this.poolCallbacks.get(poolAddress);
    if (callbacks) {
      let callbackIdToRemove = null;

      // Find and remove the callback
      for (const callback of callbacks) {
        if (callback.tokenId === tokenId && callback.chatId === chatId) {
          callbackIdToRemove = callback.callbackId;
          callbacks.delete(callback);
          console.log(`Unregistered position callback for pool ${poolAddress}, tokenId ${tokenId}, chat ${chatId}`);
          break;
        }
      }

      // If no more callbacks for this pool, remove the pool callback entirely
      if (callbacks.size === 0) {
        this.poolCallbacks.delete(poolAddress);

        if (callbackIdToRemove) {
          const poolService = require('../../uniswap/pool');
          poolService.unregisterPoolUpdateCallback(poolAddress, callbackIdToRemove);
          console.log(`Removed pool callback for ${poolAddress} with ID: ${callbackIdToRemove} - no more positions tracking`);
        }
      }
    }
  }

  /**
   * Handle pool update callback from the pool service
   * @param {TelegramBot} bot - The bot instance
   * @param {string} poolAddress - Pool address that was updated
   * @param {Object} updateData - Update data from pool service
   */
  static async handlePoolUpdate(bot, poolAddress, updateData) {
    const callbacks = this.poolCallbacks.get(poolAddress);
    if (!callbacks || callbacks.size === 0) {
      return;
    }

    try {
      // Import necessary modules
      const PositionMonitor = require('../../uniswap/position-monitor');
      const MongoStateManager = require('../../database/mongo');

      // Create temporary instances to get updated position data
      const stateManager = new MongoStateManager();
      await stateManager.connect();

      const tempMonitor = new PositionMonitor(updateData.poolInfo.client, stateManager);

      // Process each registered position for this pool
      for (const callbackData of callbacks) {
        try {
          // Get fresh position details with updated token amounts
          const updatedPosition = await tempMonitor.getPositionDetails(BigInt(callbackData.tokenId), false);

          if (updatedPosition.error) {
            console.warn(`Error getting updated position details for token ID ${callbackData.tokenId}:`, updatedPosition.error);
            continue;
          }

          // Check if position is still in range
          if (!updatedPosition.inRange) {
            // Position went out of range, unregister callback
            this.unregisterPositionCallback(poolAddress, callbackData.tokenId, callbackData.chatId);
            continue;
          }

          // Create updated position message
          const positionMessage = new PositionMessage(updatedPosition, true);

          // Update the message in Telegram
          await bot.editMessageText(positionMessage.toString(), {
            chat_id: callbackData.chatId,
            message_id: callbackData.messageId,
            parse_mode: 'Markdown',
            disable_web_page_preview: true
          });

          // Update position data in MongoDB
          await stateManager.updatePosition(
              callbackData.tokenId,
              updatedPosition.walletAddress || 'unknown',
              callbackData.chatId,
              {
                token0Amount: updatedPosition.token0Amount,
                token1Amount: updatedPosition.token1Amount,
                currentPrice: updatedPosition.currentPrice,
                inRange: updatedPosition.inRange,
                liquidity: updatedPosition.liquidity?.toString()
              }
          );

          console.log(`Updated position message for token ID ${callbackData.tokenId} in chat ${callbackData.chatId} via LP callback`);

        } catch (error) {
          console.error(`Error updating position message for token ID ${callbackData.tokenId}:`, error.message);
        }
      }

      await stateManager.close();

    } catch (error) {
      console.error(`Error handling pool update for LP positions in pool ${poolAddress}:`, error.message);
    }
  }

  /**
   * Update a specific position message
   * @param {TelegramBot} bot - The bot instance
   * @param {number} chatId - Chat ID
   * @param {number} messageId - Message ID
   * @param {Object} position - Updated position data
   */
  static async updatePositionMessage(bot, chatId, messageId, position) {
    try {
      const positionMessage = new PositionMessage(position, true);

      await bot.editMessageText(positionMessage.toString(), {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown',
        disable_web_page_preview: true
      });

      console.log(`Updated individual position message for token ID ${position.tokenId} in chat ${chatId}`);
    } catch (error) {
      console.error(`Error updating individual position message:`, error.message);
    }
  }

  /**
   * Clean up callbacks for a specific chat (e.g., when user stops monitoring)
   * @param {number} chatId - Chat ID to clean up
   */
  static cleanupCallbacksForChat(chatId) {
    for (const [poolAddress, callbacks] of this.poolCallbacks.entries()) {
      const toRemove = [];

      for (const callback of callbacks) {
        if (callback.chatId === chatId) {
          toRemove.push(callback);
        }
      }

      // Remove callbacks for this chat
      for (const callback of toRemove) {
        callbacks.delete(callback);
        console.log(`Removed callback for chat ${chatId}, pool ${poolAddress}, tokenId ${callback.tokenId}`);
      }

      // If no more callbacks for this pool, remove the pool callback entirely
      if (callbacks.size === 0) {
        this.poolCallbacks.delete(poolAddress);
        const poolService = require('../../uniswap/pool');
        poolService.unregisterPoolUpdateCallback(poolAddress);
        console.log(`Removed pool callback for ${poolAddress} - no more positions tracking`);
      }
    }
  }

  /**
   * Get all active callbacks (for debugging)
   * @returns {Map} Map of pool callbacks
   */
  static getActiveCallbacks() {
    return this.poolCallbacks;
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

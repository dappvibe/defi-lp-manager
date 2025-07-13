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
   * @param {string} timezone - User timezone
   * @param {boolean} isUpdate - Whether this is an update message
   */
  constructor(position, timezone = 'UTC', isUpdate = false) {
    this.position = position;
    this.timezone = timezone;
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
      message += `\n🕐 Updated: ${getTimeInTimezone(this.timezone)}`;
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
   * Register command handlers with the bot
   * @param {TelegramBot} bot - The bot instance
   * @param {Object} positionMonitor - Position monitor instance
   * @param {String} timezone - User timezone
   */
  static onText(bot, positionMonitor, timezone) {
    bot.onText(/\/lp/, (msg) => {
      this.handle(bot, msg, positionMonitor, timezone);
    });
  }

  /**
   * Handle lp command
   * @param {TelegramBot} bot - The bot instance
   * @param {Object} msg - Message object from Telegram
   * @param {Object} positionMonitor - Position monitor instance
   * @param {String} timezone - User timezone
   */
  static async handle(bot, msg, positionMonitor, timezone) {
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
            const positionMessage = new PositionMessage(position, timezone, false);

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
              const positionData = {
                ...position,
                walletAddress: walletAddress,
                poolAddress: await positionMonitor.getPoolAddressForPosition(position)
              };
              await positionMonitor.mongoStateManager.savePosition(positionData, chatId, sentMessage.message_id);
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

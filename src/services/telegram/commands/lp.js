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
  constructor(position) {
    super();
    this.position = position;
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

    const { getTimeInTimezone } = require('../../../utils/time');
    message += `\n🕐 Updated: ${getTimeInTimezone()}`;

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

    // Store position messages for updating (tokenId => PositionMessage)
    this.messages = new Map();

    /**
     * Store event listener reference for cleanup
     * @type {Function|null}
     */
    this.swapEventListener = (swapInfo, poolData) => {
      return this.onSwap(swapInfo, poolData);
    };

    this.registerHandlers();
  }

  /**
   * Register command handlers with the bot
   */
  registerHandlers() {
    this.bot.onText(/\/lp/, (msg) => {
      return this.handle(msg);
    });
  }

  /**
   * Handle lp command
   * @param {Object} msg - Message object from Telegram
   */
  async handle(msg) {
    const chatId = msg.chat.id;

    const monitoredWallets = this.walletService.getWalletsForChat(chatId);
    if (monitoredWallets.length === 0) {
      await this.bot.send(new NoWalletsMessage(chatId));
      return;
    }

    try {
      // Process each wallet
      for (let i = 0; i < monitoredWallets.length; i++) {
        const walletAddress = monitoredWallets[i];

        // Send initial wallet message with loading status
        const loadingMessage = await this.bot.send(new WalletLoadingMessage(chatId, i, walletAddress));

        // Get positions for this wallet
        const positions = await Position.fetchPositions(walletAddress);
        if (positions.length === 0) {
          // Replace loading message with "no positions" message
          await this.bot.send(new NoPositionsMessage(chatId, loadingMessage.id));
        } else {
          // Process each position
          for (let p = 0; p < positions.length; p++) {
            const position = positions[p];

            // Create position message
            let positionMessage = new PositionMessage(position, false);
            positionMessage.chatId = chatId;

            // Replace loading message with first position
            if (p === 0) positionMessage.id = loadingMessage.id;
            this.messages[position.tokenId] = positionMessage = await this.bot.send(positionMessage);

            // Save position to MongoDB with message ID
            try {
              await this.mongo.savePosition({
                ...position.toObject(),
                walletAddress: walletAddress,
                poolAddress: position.pool.address
              });

              this.listenSwaps(position.tokenId);
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

  listenSwaps(tokenId) {
    const message = this.messages[tokenId];
    if (!message) throw new Error(`No position message found for token ID ${tokenId}`);

    const pool = message.position.pool;
    pool.startMonitoring().then();
    pool.removeListener('swap', this.swapEventListener);
    pool.on('swap', this.swapEventListener);
  }

  /**
   * Handle swap event from PoolService
   * @param {Object} swapInfo - Swap information
   * @param {Object} poolData - Pool data
   */
  async onSwap(swapInfo, poolData) {
    const activePositions = Object.values(this.messages).filter(message => message.position.pool.address === poolData.address);

    try {
      // Process each active position for this pool
      for (const message of activePositions) {
        const position = message.position;
        try {
          // Get fresh position details with updated token amounts
          const updatedPositionData = await Position.fetchPositionDetails(position.tokenId, position.isStaked);
          message.position = new Position(updatedPositionData);

          // Update the message in Telegram
          await this.bot.send(message);

          // Update position data in MongoDB
          await this.mongo.savePosition(
              updatedPositionData.tokenId,
              position.walletAddress || 'unknown',
              message.chatId,
              {
                token0Amount: updatedPositionData.token0Amount,
                token1Amount: updatedPositionData.token1Amount,
                currentPrice: updatedPositionData.currentPrice,
                inRange: updatedPositionData.inRange,
                liquidity: updatedPositionData.liquidity?.toString()
              }
          );
        } catch (error) {
          console.error(`Error updating position message for token ID ${message.tokenId}:`, error.message);
        }
      }
    } catch (error) {
      console.error(`Error handling swap event for LP positions in pool ${poolData.address}:`, error.message);
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

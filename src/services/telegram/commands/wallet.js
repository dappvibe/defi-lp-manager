/**
 * Wallet command handler for Telegram bot
 * Handles monitoring wallet positions
 * Usage: /wallet <address>
 */

const { isValidEthereumAddress } = require('../../uniswap/utils');

/**
 * Represents a wallet address prompt message
 */
class WalletPromptMessage {
  /**
   * Get the formatted message content
   * @returns {string} The prompt message
   */
  toString() {
    return "Send a wallet address to monitor PancakeSwap V3 positions:";
  }

  /**
   * Get the reply markup for the message
   * @returns {Object} Reply markup object
   */
  getReplyMarkup() {
    return { force_reply: true };
  }
}

/**
 * Represents an invalid address message
 */
class InvalidAddressMessage {
  /**
   * Get the formatted message content
   * @returns {string} The invalid address message
   */
  toString() {
    return "❌ Invalid Ethereum address. Please send a valid wallet address.";
  }
}

/**
 * Represents a processing wallet message
 */
class ProcessingWalletMessage {
  /**
   * Get the formatted message content
   * @returns {string} The processing message
   */
  toString() {
    return "⏳ Processing wallet address...";
  }
}

/**
 * Represents a monitoring status message
 */
class MonitoringStatusMessage {
  /**
   * Create a monitoring status message instance
   * @param {boolean} isAlreadyMonitored - Whether wallet was already monitored
   */
  constructor(isAlreadyMonitored) {
    this.isAlreadyMonitored = isAlreadyMonitored;
  }

  /**
   * Get the formatted message content
   * @returns {string} The monitoring status message
   */
  toString() {
    const monitoringStatus = this.isAlreadyMonitored
      ? "✅ Already monitoring this wallet"
      : "✅ Started monitoring this wallet for position changes";

    return `${monitoringStatus}\n\n💡 Use /lp to view current positions for monitored wallets.`;
  }
}

/**
 * Represents a wallet processing error message
 */
class WalletProcessingErrorMessage {
  /**
   * Create a wallet processing error message instance
   * @param {string} errorMessage - Error message
   */
  constructor(errorMessage) {
    this.errorMessage = errorMessage;
  }

  /**
   * Get the formatted message content
   * @returns {string} The error message
   */
  toString() {
    return `❌ Error processing wallet: ${this.errorMessage}`;
  }
}

/**
 * Represents a stop wallet instruction message
 */
class StopWalletInstructionMessage {
  /**
   * Create a stop wallet instruction message instance
   * @param {Array} monitoredWallets - Array of monitored wallet addresses
   */
  constructor(monitoredWallets) {
    this.monitoredWallets = monitoredWallets;
  }

  /**
   * Get the formatted message content
   * @returns {string} The instruction message
   */
  toString() {
    const walletList = this.monitoredWallets.map((addr, idx) =>
      `${idx + 1}. \`${addr}\``
    ).join('\n');

    return `Use /stop_wallet <address> to stop monitoring a specific wallet.\n\nCurrently monitoring:\n${walletList}`;
  }
}

/**
 * Represents a stop monitoring success message
 */
class StopMonitoringSuccessMessage {
  /**
   * Create a stop monitoring success message instance
   * @param {string} walletAddress - Wallet address that was stopped
   */
  constructor(walletAddress) {
    this.walletAddress = walletAddress;
  }

  /**
   * Get the formatted message content
   * @returns {string} The success message
   */
  toString() {
    return `✅ Stopped monitoring wallet: ${this.walletAddress}`;
  }
}

/**
 * Represents a wallet not found message
 */
class WalletNotFoundMessage {
  /**
   * Create a wallet not found message instance
   * @param {string} walletAddress - Wallet address that was not found
   */
  constructor(walletAddress) {
    this.walletAddress = walletAddress;
  }

  /**
   * Get the formatted message content
   * @returns {string} The not found message
   */
  toString() {
    return `❌ Wallet not found in monitoring list: ${this.walletAddress}`;
  }
}

/**
 * Represents a no wallets monitored message
 */
class NoWalletsMonitoredMessage {
  /**
   * Get the formatted message content
   * @returns {string} The no wallets message
   */
  toString() {
    return "No wallets are currently being monitored.";
  }
}

/**
 * Represents a wallet list message
 */
class WalletListMessage {
  /**
   * Create a wallet list message instance
   * @param {Array} monitoredWallets - Array of monitored wallet addresses
   */
  constructor(monitoredWallets) {
    this.monitoredWallets = monitoredWallets;
  }

  /**
   * Get the formatted message content
   * @returns {string} The wallet list message
   */
  toString() {
    const walletList = this.monitoredWallets.map((addr, idx) =>
      `${idx + 1}. \`${addr}\``
    ).join('\n');

    return `📊 Monitoring ${this.monitoredWallets.length} wallet(s):\n\n${walletList}`;
  }
}

class WalletHandler {
  /**
   * Register command handlers with the bot
   * @param {TelegramBot} bot - The bot instance
   * @param {object} positionMonitor - Position monitor service
   * @param {string} timezone - User timezone
   */
  static onText(bot, positionMonitor, timezone) {
    // Wallet position monitoring commands
    bot.onText(/\/wallet(?:\s+(.+))?/, (msg, match) => {
      this.handle(bot, msg, match, positionMonitor, timezone);
    });

    bot.onText(/\/stop_wallet(?:\s+(.+))?/, (msg, match) => {
      this.handleStopWallet(bot, msg, match, positionMonitor);
    });

    bot.onText(/\/list_wallets/, (msg) => {
      this.handleListWallets(bot, msg, positionMonitor);
    });
  }

  /**
   * Handle wallet command to start monitoring positions
   * @param {object} bot - Telegram bot instance
   * @param {object} msg - Message object
   * @param {Array} match - Regex match result
   * @param {object} positionMonitor - Position monitor service
   * @param {string} timezone - User timezone
   */
  static async handle(bot, msg, match, positionMonitor, timezone) {
    const chatId = msg.chat.id;

    // If address is provided with command
    if (match && match[1] && match[1].trim()) {
      const walletAddress = match[1].trim();
      await this.processWalletAddress(bot, chatId, walletAddress, positionMonitor, timezone);
      return;
    }

    // Prompt for address
    const promptMessage = new WalletPromptMessage();
    const promptMsg = await bot.sendMessage(
      chatId,
      promptMessage.toString(),
      { reply_markup: promptMessage.getReplyMarkup() }
    );

    // Listen for reply
    bot.onReplyToMessage(chatId, promptMsg.message_id, async (replyMsg) => {
      const walletAddress = replyMsg.text.trim();
      await this.processWalletAddress(bot, chatId, walletAddress, positionMonitor, timezone);
    });
  }

  /**
   * Process wallet address for monitoring
   * @param {object} bot - Telegram bot
   * @param {number} chatId - Chat ID
   * @param {string} walletAddress - Wallet address
   * @param {object} positionMonitor - Position monitor service
   * @param {string} timezone - User timezone
   */
  static async processWalletAddress(bot, chatId, walletAddress, positionMonitor, timezone) {
    // Validate address
    if (!isValidEthereumAddress(walletAddress)) {
      const invalidMessage = new InvalidAddressMessage();
      await bot.sendMessage(chatId, invalidMessage.toString());
      return;
    }

    // Send processing message
    const processingMessage = new ProcessingWalletMessage();
    const statusMsg = await bot.sendMessage(chatId, processingMessage.toString());

    try {
      // Check if already monitoring
      const isAlreadyMonitored = positionMonitor.monitoredWallets.has(walletAddress.toLowerCase());

      // Start monitoring the wallet
      positionMonitor.startMonitoring(walletAddress, chatId);

      // Create and send monitoring status message
      const statusMessage = new MonitoringStatusMessage(isAlreadyMonitored);
      await bot.editMessageText(statusMessage.toString(), {
        chat_id: chatId,
        message_id: statusMsg.message_id
      });

    } catch (error) {
      console.error('Error processing wallet:', error);
      const errorMessage = new WalletProcessingErrorMessage(error.message);
      await bot.editMessageText(
        errorMessage.toString(),
        { chat_id: chatId, message_id: statusMsg.message_id }
      );
    }
  }

  /**
   * Handle stop monitoring command
   * @param {object} bot - Telegram bot
   * @param {object} msg - Message object
   * @param {Array} match - Regex match result
   * @param {object} positionMonitor - Position monitor
   */
  static async handleStopWallet(bot, msg, match, positionMonitor) {
    const chatId = msg.chat.id;

    // If address is provided with command
    if (match && match[1] && match[1].trim()) {
      const walletAddress = match[1].trim();
      await this.processStopMonitoring(bot, chatId, walletAddress, positionMonitor);
      return;
    }

    // If user has only one monitored wallet, stop that one
    const monitoredWallets = positionMonitor.getMonitoredWallets();
    if (monitoredWallets.length === 1) {
      await this.processStopMonitoring(bot, chatId, monitoredWallets[0], positionMonitor);
      return;
    }

    // Send instruction message with wallet list
    const instructionMessage = new StopWalletInstructionMessage(monitoredWallets);
    await bot.sendMessage(
      chatId,
      instructionMessage.toString(),
      { parse_mode: 'Markdown' }
    );
  }

  /**
   * Process stop monitoring request
   * @param {object} bot - Telegram bot
   * @param {number} chatId - Chat ID
   * @param {string} walletAddress - Wallet address
   * @param {object} positionMonitor - Position monitor
   */
  static async processStopMonitoring(bot, chatId, walletAddress, positionMonitor) {
    // Validate address
    if (!isValidEthereumAddress(walletAddress)) {
      const invalidMessage = new InvalidAddressMessage();
      await bot.sendMessage(chatId, invalidMessage.toString());
      return;
    }

    // Stop monitoring
    const success = positionMonitor.stopMonitoring(walletAddress);

    if (success) {
      const successMessage = new StopMonitoringSuccessMessage(walletAddress);
      await bot.sendMessage(chatId, successMessage.toString());
    } else {
      const notFoundMessage = new WalletNotFoundMessage(walletAddress);
      await bot.sendMessage(chatId, notFoundMessage.toString());
    }
  }

  /**
   * List all monitored wallets
   * @param {object} bot - Telegram bot
   * @param {object} msg - Message object
   * @param {object} positionMonitor - Position monitor
   */
  static async handleListWallets(bot, msg, positionMonitor) {
    const chatId = msg.chat.id;
    const monitoredWallets = positionMonitor.getMonitoredWallets();

    if (monitoredWallets.length === 0) {
      const noWalletsMessage = new NoWalletsMonitoredMessage();
      await bot.sendMessage(chatId, noWalletsMessage.toString());
      return;
    }

    const walletListMessage = new WalletListMessage(monitoredWallets);
    await bot.sendMessage(
      chatId,
      walletListMessage.toString(),
      { parse_mode: 'Markdown' }
    );
  }

  /**
   * Returns a brief help description with command signature
   * @returns {string} One-line help text
   */
  static help() {
    return "/wallet <address> - Monitor Uniswap V3 positions for a wallet";
  }

  /**
   * Returns usage information for the wallet command
   * @returns {string} Help text for humans
   */
  static usage() {
    return `👛 **Wallet Command Help**

**Usage:**
\`/wallet <address>\` - Start monitoring a wallet's positions
\`/stop_wallet <address>\` - Stop monitoring a specific wallet
\`/list_wallets\` - List all wallets monitored in this chat

**Examples:**
\`/wallet 0x1234...5678\` - Monitor positions for this wallet

**Notes:**
• The bot will track position changes in real-time
• You will be notified when positions change
• You can monitor multiple wallets in one chat

**Related Commands:**
• \`/pool\` - Monitor pool prices instead
• \`/notify\` - Set price alerts for pools`;
  }
}

module.exports = WalletHandler;

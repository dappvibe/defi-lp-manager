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
   * Create a new WalletHandler instance
   * @param {TelegramBot} bot - The bot instance
   * @param {object} walletRegistry - Wallet service instance
   */
  constructor(bot, walletRegistry) {
    this.bot = bot;
    this.walletRegistry = walletRegistry;

    // Register handlers on instantiation
    this.registerHandlers();
  }

  /**
   * Register command handlers with the bot
   */
  registerHandlers() {
    // Wallet position monitoring commands
    this.bot.onText(/\/wallet(?:\s+(.+))?/, (msg, match) => {
      this.handle(msg, match);
    });

    this.bot.onText(/\/stop_wallet(?:\s+(.+))?/, (msg, match) => {
      this.handleStopWallet(msg, match);
    });

    this.bot.onText(/\/list_wallets/, (msg) => {
      this.handleListWallets(msg);
    });
  }

  /**
   * Handle wallet command to start monitoring positions
   * @param {object} msg - Message object
   * @param {Array} match - Regex match result
   */
  async handle(msg, match) {
    const chatId = msg.chat.id;

    // If address is provided with command
    if (match && match[1] && match[1].trim()) {
      const walletAddress = match[1].trim();
      await this.processWalletAddress(chatId, walletAddress);
      return;
    }

    // Prompt for address
    const promptMessage = new WalletPromptMessage();
    const promptMsg = await this.bot.sendMessage(
      chatId,
      promptMessage.toString(),
      { reply_markup: promptMessage.getReplyMarkup() }
    );

    // Listen for reply
    this.bot.onReplyToMessage(chatId, promptMsg.message_id, async (replyMsg) => {
      const walletAddress = replyMsg.text.trim();
      await this.processWalletAddress(chatId, walletAddress);
    });
  }

  /**
   * Process wallet address for monitoring
   * @param {number} chatId - Chat ID
   * @param {string} walletAddress - Wallet address
   */
  async processWalletAddress(chatId, walletAddress) {
    // Validate address
    if (!isValidEthereumAddress(walletAddress)) {
      const invalidMessage = new InvalidAddressMessage();
      await this.bot.sendMessage(chatId, invalidMessage.toString());
      return;
    }

    // Send processing message
    const processingMessage = new ProcessingWalletMessage();
    const statusMsg = await this.bot.sendMessage(chatId, processingMessage.toString());

    try {
      // Check if already monitoring and add wallet
      const wasAdded = await this.walletRegistry.addWallet(walletAddress, chatId);

      // Create and send monitoring status message
      const statusMessage = new MonitoringStatusMessage(!wasAdded);
      await this.bot.editMessageText(statusMessage.toString(), {
        chat_id: chatId,
        message_id: statusMsg.message_id
      });

    } catch (error) {
      console.error('Error processing wallet:', error);
      const errorMessage = new WalletProcessingErrorMessage(error.message);
      await this.bot.editMessageText(
        errorMessage.toString(),
        { chat_id: chatId, message_id: statusMsg.message_id }
      );
    }
  }

  /**
   * Handle stop monitoring command
   * @param {object} msg - Message object
   * @param {Array} match - Regex match result
   */
  async handleStopWallet(msg, match) {
    const chatId = msg.chat.id;

    // If address is provided with command
    if (match && match[1] && match[1].trim()) {
      const walletAddress = match[1].trim();
      await this.processStopMonitoring(chatId, walletAddress);
      return;
    }

    // If user has only one monitored wallet, stop that one
    const monitoredWallets = this.walletRegistry.getWalletsForChat(chatId);
    if (monitoredWallets.length === 1) {
      await this.processStopMonitoring(chatId, monitoredWallets[0]);
      return;
    }

    // Send instruction message with wallet list
    const instructionMessage = new StopWalletInstructionMessage(monitoredWallets);
    await this.bot.sendMessage(
      chatId,
      instructionMessage.toString(),
      { parse_mode: 'Markdown' }
    );
  }

  /**
   * Process stop monitoring request
   * @param {number} chatId - Chat ID
   * @param {string} walletAddress - Wallet address
   */
  async processStopMonitoring(chatId, walletAddress) {
    // Validate address
    if (!isValidEthereumAddress(walletAddress)) {
      const invalidMessage = new InvalidAddressMessage();
      await this.bot.sendMessage(chatId, invalidMessage.toString());
      return;
    }

    // Stop monitoring
    const success = await this.walletRegistry.removeWallet(walletAddress, chatId);

    if (success) {
      const successMessage = new StopMonitoringSuccessMessage(walletAddress);
      await this.bot.sendMessage(chatId, successMessage.toString());
    } else {
      const notFoundMessage = new WalletNotFoundMessage(walletAddress);
      await this.bot.sendMessage(chatId, notFoundMessage.toString());
    }
  }

  /**
   * List all monitored wallets
   * @param {object} msg - Message object
   */
  async handleListWallets(msg) {
    const chatId = msg.chat.id;
    const monitoredWallets = this.walletRegistry.getWalletsForChat(chatId);

    if (monitoredWallets.length === 0) {
      const noWalletsMessage = new NoWalletsMonitoredMessage();
      await this.bot.sendMessage(chatId, noWalletsMessage.toString());
      return;
    }

    const walletListMessage = new WalletListMessage(monitoredWallets);
    await this.bot.sendMessage(
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
• \`/pool\` - Monitor pool prices instead`;
  }
}

module.exports = WalletHandler;

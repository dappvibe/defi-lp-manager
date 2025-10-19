const TelegramMessage = require("../message");
const AbstractHandler = require("../handler");

/**
 * Represents a wallet invitation message
 */
class NoWalletsMessage extends TelegramMessage {
  constructor(chatId) {
    super();
    this.chatId = chatId;
  }

  toString() {
    let content = "💼 **Get Started with Wallet Tracking**\n\n";
    content += "📍 You don't have any wallets tracked yet!\n\n";
    content += "🚀 **Add your first wallet to:**\n";
    content += "• Monitor your Uniswap V3 positions\n";
    content += "• Track position value changes\n";
    content += "• Get alerts on important events\n\n";
    content += "💡 Use `/wallet <address>` to start tracking a wallet.\n\n";
    return content;
  }
}

/**
 * Represents a start message with its content and formatting
 */
class StartMessage extends TelegramMessage {
  /**
   * Create a start message instance
   * @param {number} chatId - The chat ID
   * @param wallets
   */
  constructor(chatId, wallets) {
    super();
    this.chatId = chatId;
    this.wallets = wallets;
  }

  /**
   * Get the formatted message content
   * @returns {string} The complete formatted message
   */
  toString() {
    let content = "🤖 **DeFi LP Manager Bot**\n\n";

    content += "🔧 **What I can do:**\n";
    content += "• Monitor Uniswap V3 liquidity pool prices\n";
    content += "• Track wallet positions and changes\n";
    content += "• Set price alerts for monitored pools\n";
    content += "• Display current liquidity positions\n\n";

    content += "Your wallets:\n";
    this.wallets.forEach(wallet => {
      content += `• ${wallet.address} (${wallet.network})\n`;
    })

    return content;
  }
}

/**
 * Handler for /start command
 * Sends welcome message to the user and shows current monitoring status
 */
class StartHandler extends AbstractHandler {
  /**
   * Create a new StartHandler instance
   * @param userModel
   */
  constructor(userModel) {
    super(userModel);
  }

  /**
   * Register command handlers with the bot
   */
  listenOn(bot) {
    this.bot = bot;
    this.bot.onText(/\/start/, (msg) => {
      this.getUser(msg).then(
        user => this.handle(msg, user)
      )
    });
  }

  /**
   * Handle start command
   * @param {Object} msg - Message object from Telegram
   * @param user
   */
  async handle(msg, user) {
    const chatId = msg.chat.id;
    const wallets = user.getWallets('arbitrum');
    if (!wallets || wallets.length === 0) {
      const walletMessage = new NoWalletsMessage(chatId);
      await this.bot.sendMessage(chatId, walletMessage.toString(), { parse_mode: 'Markdown' });
      return;
    }

    // display current status
    const startMessage = new StartMessage(chatId, wallets);
    await this.bot.sendMessage(chatId, startMessage.toString(), { parse_mode: 'Markdown' });
  }

  /**
   * Returns a brief help description with command signature
   * @returns {string} One-line help text
   */
  static help() {
    return "/start - Begin using the bot and see welcome message";
  }
}

module.exports = StartHandler;

/**
 * Represents a start message with its content and formatting
 */
class StartMessage {
  /**
   * Create a start message instance
   * @param {number} chatId - The chat ID
   * @param {Object} monitoredPools - Object containing monitored pools
   * @param {Object} positionMonitor - Position monitor instance
   */
  constructor(chatId, monitoredPools, positionMonitor) {
    this.chatId = chatId;
    this.monitoredPools = monitoredPools;
    this.positionMonitor = positionMonitor;
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
    content += "📊 **Current Monitoring Status:**\n\n";

    content += this._getPoolsSection();
    content += this._getWalletsSection();
    content += "Use /help for available commands.";

    return content;
  }

  /**
   * Get the pools section content
   * @returns {string} The pools section
   */
  _getPoolsSection() {
    const poolsInChat = Object.entries(this.monitoredPools).filter(
      ([_, poolData]) => poolData.chatId === this.chatId
    );

    if (poolsInChat.length > 0) {
      let section = `🏊 **Pools (${poolsInChat.length}):**\n`;
      poolsInChat.forEach(([address, data], idx) => {
        const pair = `${data.token1?.symbol || '???'}/${data.token0?.symbol || '???'}`;
        const price = data.lastPriceT1T0 ? data.lastPriceT1T0.toFixed(8) : 'N/A';
        section += `${idx + 1}. ${pair} - ${price}\n`;
        section += `   \`${address}\`\n`;
      });
      return section + "\n";
    } else {
      return "🏊 **Pools:** None monitored in this chat\n\n";
    }
  }

  /**
   * Get the wallets section content
   * @returns {string} The wallets section
   */
  _getWalletsSection() {
    const monitoredWallets = this.positionMonitor.getMonitoredWallets();

    if (monitoredWallets.length > 0) {
      let section = `💼 **Wallets (${monitoredWallets.length}):**\n`;
      monitoredWallets.forEach((addr, idx) => {
        section += `${idx + 1}. \`${addr}\`\n`;
      });
      return section + "\n";
    } else {
      return "💼 **Wallets:** None monitored\n\n";
    }
  }
}

/**
 * Handler for /start command
 * Sends welcome message to the user and shows current monitoring status
 */
class StartHandler {
  /**
   * Create a new StartHandler instance
   * @param poolsConfig
   * @param positionModel
   */
  constructor(poolsConfig, positionModel) {
    this.monitoredPools = poolsConfig.getPools('pancakeswap', 'arbitrum');
    this.positionModel = positionModel;
  }

  /**
   * Register command handlers with the bot
   */
  attach(bot) {
    this.bot = bot;
    this.bot.onText(/\/start/, (msg) => {
      return this.handleText(msg);
    });
  }

  /**
   * Handle start command
   * @param {Object} msg - Message object from Telegram
   */
  async handleText(msg) {
    const chatId = msg.chat.id;
    const startMessage = new StartMessage(chatId, this.monitoredPools, this.positionModel);
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

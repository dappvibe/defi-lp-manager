/**
 * Wallet command handler for Telegram bot
 * Handles monitoring wallet positions
 * Usage: /wallet <address>
 */

 const {isAddress} = require("viem");
const AbstractHandler = require("../handler");
const TelegramMessage = require("../message");

class WalletPromptMessage extends TelegramMessage {
  toString() {
    return "Send a wallet address to monitor PancakeSwap V3 positions:";
  }

  get options() {
    return {
      reply_markup: {
        force_reply: true,
        input_field_placeholder: "Enter public address"
      }
    };
  }
}

/**
 * Summary of wallets being monitored with a button to add more.
 */
class WalletListMessage extends TelegramMessage {
  constructor(chatId, wallets = []) {
    super();
    this.chatId = chatId;
    this.wallets = wallets;
  }

  toString() {
    if (this.wallets.length === 0) {
      return "No wallets are currently being monitored.";
    } else {
      return `📊 Monitoring ${this.wallets.length} wallet(s):`;
    }
  }

  get options() {
    return {
      disable_web_page_preview: true,
      reply_markup: {
        inline_keyboard: [[
          { text: 'Add Wallet', callback_data: 'add_wallet' }
        ]]
      }
    }
  }
}

/**
 * Represents a single wallet message
 */
class ListedWalletMessage extends TelegramMessage {
  /**
   * Create a listed wallet message instance
   * @param {number} chatId - The chat ID
   * @param {Object} wallet - Wallet address
   */
  constructor(chatId, wallet) {
    super();
    this.chatId = chatId;
    this.wallet = wallet;
  }

  /**
   * Get the formatted message content
   * @returns {string} The wallet message
   */
  toString() {
    return `[${this.wallet.address}](https://arbiscan.io/address/${this.wallet.address})`;
  }

  get options() {
    return {
      parse_mode: 'Markdown',
      disable_web_page_preview: true,
      reply_markup: {
        inline_keyboard: [[
          { text: 'Untrack', callback_data: 'remove_wallet_' + this.wallet.address }
        ]]
      }
    };
  }
}

class WalletHandler extends AbstractHandler {
  wallets;
  chainId;

  constructor(UserModel, WalletModel, chainId) {
    super(UserModel);
    this.wallets = WalletModel;
    this.chainId = chainId;
  }

  /**
   * Register command handlers with the bot. Separate method to allow testing idividual handlers.
   * @param {object} bot - Telegram bot instance
   */
  listenOn(bot) {
    this.bot = bot;
    this.bot.onText(/\/wallet(?:\s+(.+))?/, this.listWallets.bind(this));

    this.bot.on('callback_query', (query) => {
      if (query.data === 'add_wallet') {
        return this.promptWallet(query)
      }

      if (query.data.startsWith('remove_wallet_')) {
        return this.removeWallet(query)
      }
    })
  }

  /**
   * Handle wallet command to start monitoring positions
   * @param {object} msg - Message object
   */
  async listWallets(msg) {
    const chatId = msg.chat.id;
    const user = await this.getUser(msg);
    await user.populate('wallets');

    await this.bot.send(new WalletListMessage(chatId, user.wallets));
    for (const [index, wallet] of user.wallets.entries()) {
      await this.bot.send(new ListedWalletMessage(chatId, wallet));
    }
  }

  async promptWallet(query) {
    const chatId = query.message.chat.id;

    // ack callback to stop loading animation
    this.bot.answerCallbackQuery(query.id);

    // Prompt for address
    const promptMessage = new WalletPromptMessage({chatId: chatId});
    const promptMsg = await this.bot.send(promptMessage);

    // Listen for reply
    let listenerId;
    listenerId = this.bot.onReplyToMessage(chatId, promptMsg.id, async (msg) => {
      const wallet = await this.saveWallet(msg);
      if (wallet) {
        this.bot.removeReplyListener(listenerId);
        this.bot.deleteMessages(msg.chat.id, [msg.message_id, promptMsg.id]).then();
        this.bot.send(new ListedWalletMessage(msg.chat.id, wallet));
      }
    });
  }

  async saveWallet(msg) {
    const address = msg.text.trim();
    if (!isAddress(address)) {
      this.bot.sendMessage(msg.chat.id, '❌ Invalid Ethereum address', { reply_to_message_id: msg.message_id });
      return false;
    }

    const user = await this.getUser(msg);
    const wallet = await this.wallets.create({
      chainId: this.chainId,
      address,
      userId: user._id,
    });

    if (!wallet) { // failed
      this.bot.sendMessage(msg.chat.id, '❌ Wallet already exists', { reply_to_message_id: msg.message_id });
      return false;
    }

    return wallet;
  }

  async removeWallet(query) {
    const address = query.data.replace('remove_wallet_', '');
    if (!isAddress(address)) {
      return this.bot.answerCallbackQuery(query.id, {
        text: '❌ Invalid Ethereum address',
        show_alert: true
      });
    }

    const user = await this.getUser(query.message);
    const count = await this.wallets.deleteOne({
      userId: user._id,
      chainId: this.chainId,
      address: address,
    })
    if (count === 0) console.warn('Wallet not found for removal: ', address);
    this.bot.deleteMessage(query.message.chat.id, query.message.message_id).then();
    return this.bot.answerCallbackQuery(query.id, { text: '✅ Wallet removed' });
  }

  /**
   * Returns a brief help description with command signature
   * @returns {string} One-line help text
   */
  static help() {
    return "/wallet <address> - Monitor Uniswap V3 positions for a wallet";
  }

  getMyCommand = () => ['wallet', 'Manage your addresses']
}

module.exports = WalletHandler;

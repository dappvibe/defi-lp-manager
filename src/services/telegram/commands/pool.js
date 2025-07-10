
/**
 * Handler for /pool command
 * Monitors Uniswap V3 pools for price changes
 * Usage: /pool <address>
 */
const { getTokenInfo, createPoolContract } = require('../../uniswap/contracts');
const poolMonitor = require('../../uniswap/pool-monitor');
const { getTimeInTimezone } = require('../../../utils/time');
const { calculatePrice } = require('../../uniswap/utils');
const { isValidEthereumAddress } = require('../../uniswap/utils');

class PoolHandler {
  /**
   * Register command handlers with the bot
   * @param {TelegramBot} bot - The bot instance
   * @param {Object} provider - Ethereum provider instance
   * @param {Object} monitoredPools - Object containing monitored pools
   * @param {String} timezone - User timezone
   */
  static onText(bot, provider, monitoredPools, timezone) {
    // Pool monitoring commands
    bot.onText(/\/pool(?:\s+(.+))?/, (msg, match) => {
      this.handle(bot, msg, match, provider, monitoredPools, timezone);
    });

    bot.onText(/\/stop_pool(?:\s+(.+))?/, (msg, match) => {
      this.handleStopPool(bot, msg, match, monitoredPools);
    });

    bot.onText(/\/list_pools/, (msg) => {
      this.handleListPools(bot, msg, monitoredPools);
    });
  }

  /**
   * Handle pool command to monitor a pool
   * @param {TelegramBot} bot - The bot instance
   * @param {Object} msg - Message object from Telegram
   * @param {Array} match - Regex match array containing the command params
   * @param {Object} provider - Ethereum provider instance
   * @param {Object} monitoredPools - Object containing monitored pools
   * @param {String} timezone - User timezone
   */
  static async handle(bot, msg, match, provider, monitoredPools, timezone) {
    const chatId = msg.chat.id;

    // If pool address is provided with command
    if (match && match[1] && match[1].trim()) {
      const poolAddress = match[1].trim();
      await this.processPoolAddress(bot, chatId, poolAddress, provider, monitoredPools, timezone);
      return;
    }

    // Prompt for address if not provided
    const promptMsg = await bot.sendMessage(
      chatId,
      "Send a Uniswap V3 pool contract address to monitor:",
      { reply_markup: { force_reply: true } }
    );

    // Listen for reply
    bot.onReplyToMessage(chatId, promptMsg.message_id, async (replyMsg) => {
      const poolAddress = replyMsg.text.trim();
      await this.processPoolAddress(bot, chatId, poolAddress, provider, monitoredPools, timezone);
    });
  }

  /**
   * Process a pool address for monitoring
   * @param {TelegramBot} bot - The bot instance
   * @param {number} chatId - Chat ID
   * @param {string} poolAddress - Pool address to monitor
   * @param {Object} provider - Ethereum provider
   * @param {Object} monitoredPools - Object containing monitored pools
   * @param {String} timezone - User timezone
   */
  static async processPoolAddress(bot, chatId, poolAddress, provider, monitoredPools, timezone) {
    // Validate address
    if (!isValidEthereumAddress(poolAddress)) {
      await bot.sendMessage(chatId, "❌ Invalid Ethereum address. Please send a valid pool contract address.");
      return;
    }

    // Check if already monitoring this pool in this chat
    if (monitoredPools[poolAddress] && monitoredPools[poolAddress].chatId === chatId) {
      await bot.sendMessage(chatId, `Already monitoring this pool in this chat.`);
      return;
    }

    // Send a loading message
    const loadingMessage = await bot.sendMessage(chatId, "⏳ Loading pool data...");

    try {
      // Create pool contract
      const poolContract = createPoolContract(poolAddress);

      // Get token0 and token1 addresses
      const [token0Address, token1Address] = await Promise.all([
        poolContract.read.token0(),
        poolContract.read.token1()
      ]);

      // Get token info
      const [token0Info, token1Info] = await Promise.all([
        getTokenInfo(token0Address),
        getTokenInfo(token1Address)
      ]);

      // Get current price
      const slot0 = await poolContract.read.slot0();
      const sqrtPriceX96 = slot0[0];
      const priceT1T0 = parseFloat(calculatePrice(sqrtPriceX96, token1Info.decimals, token0Info.decimals));

      // Update the loading message with the initial price info
      const time = getTimeInTimezone(timezone);
      const initialText = `${priceT1T0.toFixed(5)} ${token0Info.symbol}/${token1Info.symbol} ${time}\nLast: N/A`;

      const updatedMessage = await bot.editMessageText(initialText, {
        chat_id: chatId,
        message_id: loadingMessage.message_id
      });

      // Prepare pool data
      const poolData = {
        chatId,
        messageId: updatedMessage.message_id,
        token0: token0Info,
        token1: token1Info,
        lastPriceT1T0: priceT1T0,
        notifications: []
      };

      // Start monitoring the pool
      await poolMonitor.startMonitoring(bot, poolAddress, poolData, provider, timezone);

      console.log(`Monitoring pool ${poolAddress} in chat ${chatId}`);
    } catch (error) {
      console.error(`Error monitoring pool ${poolAddress}:`, error);
      await bot.editMessageText(`Error monitoring pool: ${error.message}`, {
        chat_id: chatId,
        message_id: loadingMessage.message_id
      });
    }
  }

  /**
   * Handle command to stop monitoring a pool
   * @param {TelegramBot} bot - The bot instance
   * @param {Object} msg - Message object from Telegram
   * @param {Array} match - Regex match array containing the command params
   * @param {Object} monitoredPools - Object containing monitored pools
   */
  static async handleStopPool(bot, msg, match, monitoredPools) {
    const chatId = msg.chat.id;

    // If pool address is provided with command
    if (match && match[1] && match[1].trim()) {
      const poolAddress = match[1].trim();
      await this.processStopMonitoring(bot, chatId, poolAddress, monitoredPools);
      return;
    }

    // If user has monitored pools in this chat, list them
    const poolsInChat = Object.entries(monitoredPools).filter(
      ([_, poolData]) => poolData.chatId === chatId
    );

    if (poolsInChat.length === 0) {
      await bot.sendMessage(chatId, "No pools are currently being monitored in this chat.");
      return;
    }

    // If only one pool is monitored, stop that one
    if (poolsInChat.length === 1) {
      const [poolAddress] = poolsInChat[0];
      await this.processStopMonitoring(bot, chatId, poolAddress, monitoredPools);
      return;
    }

    // List pools to stop
    const poolList = poolsInChat.map(([addr, poolData], idx) =>
      `${idx + 1}. ${poolData.token1?.symbol || ''}/${poolData.token0?.symbol || ''} (\`${addr}\`)`
    ).join('\n');

    await bot.sendMessage(
      chatId,
      `Use /stop_pool <address> to stop monitoring a specific pool.\n\nCurrently monitoring:\n${poolList}`,
      { parse_mode: 'Markdown' }
    );
  }

  /**
   * Process stop monitoring request
   * @param {TelegramBot} bot - The bot instance
   * @param {number} chatId - Chat ID
   * @param {string} poolAddress - Pool address to stop monitoring
   * @param {Object} monitoredPools - Object containing monitored pools
   */
  static async processStopMonitoring(bot, chatId, poolAddress, monitoredPools) {
    // Check if pool exists and belongs to this chat
    if (!monitoredPools[poolAddress] || monitoredPools[poolAddress].chatId !== chatId) {
      await bot.sendMessage(chatId, `Pool ${poolAddress} is not monitored in this chat.`);
      return;
    }

    try {
      // Stop monitoring the pool
      await poolMonitor.stopMonitoring(poolAddress);
      await bot.sendMessage(chatId, `✅ Stopped monitoring pool: ${poolAddress}`);
    } catch (error) {
      console.error(`Error stopping pool monitoring: ${error.message}`);
      await bot.sendMessage(chatId, `Error stopping pool monitoring: ${error.message}`);
    }
  }

  /**
   * List all pools being monitored in this chat
   * @param {TelegramBot} bot - The bot instance
   * @param {Object} msg - Message object from Telegram
   * @param {Object} monitoredPools - Object containing monitored pools
   */
  static async handleListPools(bot, msg, monitoredPools) {
    const chatId = msg.chat.id;

    // Get pools monitored in this chat
    const poolsInChat = Object.entries(monitoredPools).filter(
      ([_, poolData]) => poolData.chatId === chatId
    );

    if (poolsInChat.length === 0) {
      await bot.sendMessage(chatId, "No pools are currently being monitored in this chat.");
      return;
    }

    // Format the pools list
    const poolsList = poolsInChat.map(([address, data], idx) => {
      const pair = `${data.token1?.symbol || '???'}/${data.token0?.symbol || '???'}`;
      const price = data.lastPriceT1T0 ? `Price: ${data.lastPriceT1T0.toFixed(8)}` : 'Price: N/A';
      const alerts = (data.notifications || []).filter(n => !n.triggered).length;

      return `${idx + 1}. ${pair} - ${price}
Pool: \`${address}\`
Alerts: ${alerts}`;
    }).join('\n\n');

    await bot.sendMessage(
      chatId,
      `📊 *Monitored Pools (${poolsInChat.length})*\n\n${poolsList}`,
      { parse_mode: 'Markdown' }
    );
  }

  /**
   * Returns a brief help description with command signature
   * @returns {string} One-line help text
   */
  static help() {
    return "/pool <address> - Monitor a Uniswap V3 pool for price changes";
  }

  /**
   * Returns usage information for the pool command
   * @returns {string} Help text for humans
   */
  static usage() {
    return `🏊 **Pool Command Help**

**Usage:**
\`/pool <address>\` - Start monitoring a Uniswap V3 pool
\`/stop_pool <address>\` - Stop monitoring a specific pool
\`/list_pools\` - List all pools monitored in this chat

**Examples:**
\`/pool 0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640\` - Monitor ETH/USDC pool

**Notes:**
• The bot will track price changes in real-time
• Use /notify to set price alerts for monitored pools
• You can monitor multiple pools in one chat

**Related Commands:**
• \`/notify <price> [pool]\` - Set price alerts
• \`/wallet\` - Monitor wallet positions instead`;
  }
}

module.exports = PoolHandler;

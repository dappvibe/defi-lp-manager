/**
 * Wallet command handler for Telegram bot
 * Handles database wallet positions
 */

const { isValidEthereumAddress } = require('../../uniswap/utils');

/**
 * Handle wallet command to start database positions
 * @param {object} bot - Telegram bot instance
 * @param {object} msg - Message object
 * @param {Array} match - Regex match result
 * @param {object} positionMonitor - Position monitor service
 * @param {string} timezone - User timezone
 */
async function handleWalletCommand(bot, msg, match, positionMonitor, timezone) {
  const chatId = msg.chat.id;

  // If address is provided with command
  if (match && match[1] && match[1].trim()) {
    const walletAddress = match[1].trim();
    await processWalletAddress(bot, chatId, walletAddress, positionMonitor, timezone);
    return;
  }

  // Prompt for address
  const promptMsg = await bot.sendMessage(
    chatId,
    "Send a wallet address to monitor PancakeSwap V3 positions:",
    { reply_markup: { force_reply: true } }
  );

  // Listen for reply
  bot.onReplyToMessage(chatId, promptMsg.message_id, async (replyMsg) => {
    const walletAddress = replyMsg.text.trim();
    await processWalletAddress(bot, chatId, walletAddress, positionMonitor, timezone);
  });
}

/**
 * Process wallet address for database
 * @param {object} bot - Telegram bot
 * @param {number} chatId - Chat ID
 * @param {string} walletAddress - Wallet address
 * @param {object} positionMonitor - Position monitor service
 * @param {string} timezone - User timezone
 */
async function processWalletAddress(bot, chatId, walletAddress, positionMonitor, timezone) {
  // Validate address
  if (!isValidEthereumAddress(walletAddress)) {
    await bot.sendMessage(chatId, "❌ Invalid Ethereum address. Please send a valid wallet address.");
    return;
  }

  // Send processing message
  const statusMsg = await bot.sendMessage(chatId, "⏳ Processing wallet address... Fetching positions...");

  try {
    // Check if already database
    const isAlreadyMonitored = positionMonitor.monitoredWallets.has(walletAddress.toLowerCase());

    // Start database the wallet
    positionMonitor.startMonitoring(walletAddress, chatId);

    // Fetch positions
    const positions = await positionMonitor.getPositions(walletAddress);

    // Format message based on database status
    const monitoringStatus = isAlreadyMonitored
      ? "✅ Already database this wallet"
      : "✅ Started database this wallet for position changes";

    // Create full message
    const message = `${monitoringStatus}\n\n${positionMonitor.formatPositionsMessage(positions, timezone)}`;

    // Update status message
    await bot.editMessageText(message, {
      chat_id: chatId,
      message_id: statusMsg.message_id
    });
  } catch (error) {
    console.error('Error processing wallet:', error);
    await bot.editMessageText(
      `❌ Error processing wallet: ${error.message}`,
      { chat_id: chatId, message_id: statusMsg.message_id }
    );
  }
}

/**
 * Handle stop database command
 * @param {object} bot - Telegram bot
 * @param {object} msg - Message object
 * @param {Array} match - Regex match result
 * @param {object} positionMonitor - Position monitor
 */
async function handleStopWalletCommand(bot, msg, match, positionMonitor) {
  const chatId = msg.chat.id;

  // If address is provided with command
  if (match && match[1] && match[1].trim()) {
    const walletAddress = match[1].trim();
    await processStopMonitoring(bot, chatId, walletAddress, positionMonitor);
    return;
  }

  // If user has only one monitored wallet, stop that one
  const monitoredWallets = positionMonitor.getMonitoredWallets();
  if (monitoredWallets.length === 1) {
    await processStopMonitoring(bot, chatId, monitoredWallets[0], positionMonitor);
    return;
  }

  // Send list of monitored wallets
  const walletList = monitoredWallets.map((addr, idx) =>
    `${idx + 1}. \`${addr}\``
  ).join('\n');

  await bot.sendMessage(
    chatId,
    `Use /stop_wallet <address> to stop monitoring a specific wallet.\n\nCurrently monitoring:\n${walletList}`,
    { parse_mode: 'Markdown' }
  );
}

/**
 * Process stop database request
 * @param {object} bot - Telegram bot
 * @param {number} chatId - Chat ID
 * @param {string} walletAddress - Wallet address
 * @param {object} positionMonitor - Position monitor
 */
async function processStopMonitoring(bot, chatId, walletAddress, positionMonitor) {
  // Validate address
  if (!isValidEthereumAddress(walletAddress)) {
    await bot.sendMessage(chatId, "❌ Invalid Ethereum address.");
    return;
  }

  // Stop database
  const success = positionMonitor.stopMonitoring(walletAddress);

  if (success) {
    await bot.sendMessage(chatId, `✅ Stopped monitoring wallet: ${walletAddress}`);
  } else {
    await bot.sendMessage(chatId, `❌ Wallet not found in monitoring list: ${walletAddress}`);
  }
}

/**
 * List all monitored wallets
 * @param {object} bot - Telegram bot
 * @param {object} msg - Message object
 * @param {object} positionMonitor - Position monitor
 */
async function handleListWalletsCommand(bot, msg, positionMonitor) {
  const chatId = msg.chat.id;
  const monitoredWallets = positionMonitor.getMonitoredWallets();

  if (monitoredWallets.length === 0) {
    await bot.sendMessage(chatId, "No wallets are currently being monitored.");
    return;
  }

  const walletList = monitoredWallets.map((addr, idx) =>
    `${idx + 1}. \`${addr}\``
  ).join('\n');

  await bot.sendMessage(
    chatId,
    `Monitoring ${monitoredWallets.length} wallet(s):\n\n${walletList}`,
    { parse_mode: 'Markdown' }
  );
}

module.exports = {
  handleWalletCommand,
  handleStopWalletCommand,
  handleListWalletsCommand,
  processWalletAddress
};

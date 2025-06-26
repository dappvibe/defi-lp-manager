/**
 * Handler for pool address monitoring
 * Processes an Ethereum address and sets up pool monitoring
 * @param {TelegramBot} bot - The bot instance
 * @param {Object} msg - Message object from Telegram
 * @param {Object} provider - Ethereum provider instance
 * @param {Object} monitoredPools - Object containing monitored pools
 * @param {string} timezone - Timezone for time display
 */
const { ethers } = require('ethers');
const { getTokenInfo, createPoolContract } = require('../../blockchain/contracts');
const poolMonitor = require('../../monitoring/pool-monitor');
const { getTimeInTimezone } = require('../../../utils/time');
const { calculatePrice } = require('../../blockchain/price-calculator');

async function handleMonitorAddress(bot, msg, provider, monitoredPools, timezone) {
  const chatId = msg.chat.id;
  const poolAddress = msg.text.trim();

  // Check if already monitoring this pool in this chat
  if (monitoredPools[poolAddress] && monitoredPools[poolAddress].chatId === chatId) {
    bot.sendMessage(chatId, `Already monitoring this pool in this chat.`);
    return;
  }

  // Send a loading message
  const loadingMessage = await bot.sendMessage(chatId, "Loading pool data...");

  try {
    // Create pool contract
    const poolContract = createPoolContract(poolAddress);

    // Get token0 and token1 addresses
    const [token0Address, token1Address] = await Promise.all([
      poolContract.token0(),
      poolContract.token1()
    ]);

    // Get token info
    const [token0Info, token1Info] = await Promise.all([
      getTokenInfo(token0Address),
      getTokenInfo(token1Address)
    ]);

    // Get current price
    const slot0 = await poolContract.slot0();
    const sqrtPriceX96 = slot0.sqrtPriceX96.toString();
    const priceT1T0 = parseFloat(calculatePrice(sqrtPriceX96, token1Info.decimals, token0Info.decimals));

    // Update the loading message with the initial price info
    const time = getTimeInTimezone(timezone);
    const initialText = `${priceT1T0.toFixed(8)} ${token1Info.symbol}/${token0Info.symbol} ${time}\nTick: ${slot0.tick}\nLast Swap: N/A`;

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
    bot.editMessageText(`Error monitoring pool: ${error.message}`, {
      chat_id: chatId,
      message_id: loadingMessage.message_id
    });
  }
}

module.exports = handleMonitorAddress;

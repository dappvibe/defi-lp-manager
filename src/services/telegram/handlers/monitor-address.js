/**
 * Handler for pool address database
 * Processes an Ethereum address and sets up pool database
 * @param {TelegramBot} bot - The bot instance
 * @param {Object} msg - Message object from Telegram
 * @param {Object} provider - Viem client instance
 * @param {Object} monitoredPools - Object containing monitored pools
 * @param {string} timezone - Timezone for time display
 */
const { getContract } = require('viem');
const { getTokenInfo, createPoolContract } = require('../../uniswap/contracts');
const poolMonitor = require('../../uniswap/pool-monitor');
const { getTimeInTimezone } = require('../../../utils/time');
const { calculatePrice } = require('../../uniswap/utils');
const { uniswapV3Pool: poolAbi } = require('../../uniswap/abis');

async function handleMonitorAddress(bot, msg, provider, monitoredPools, timezone) {
  const chatId = msg.chat.id;
  const poolAddress = msg.text.trim();

  // Check if already database this pool in this chat
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
    const sqrtPriceX96 = slot0[0]; // slot0 returns an array [sqrtPriceX96, tick, observationIndex, observationCardinality, observationCardinalityNext, feeProtocol, unlocked]
    const tick = slot0[1];
    const priceT1T0 = parseFloat(calculatePrice(sqrtPriceX96, token1Info.decimals, token0Info.decimals));

    // Update the loading message with the initial price info
    const time = getTimeInTimezone(timezone);
    const initialText = `${priceT1T0.toFixed(8)} ${token1Info.symbol}/${token0Info.symbol} ${time}\nTick: ${tick}\nLast Swap: N/A`;

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

    // Start database the pool
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

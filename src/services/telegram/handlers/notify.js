/**
 * Handler for /notify command
 * Sets price alerts for monitored pools
 * @param {TelegramBot} bot - The bot instance
 * @param {Object} msg - Message object from Telegram
 * @param {Array} match - Regex match array containing the command params
 * @param {Object} monitoredPools - Object containing monitored pools
 */
function handleNotify(bot, msg, match, monitoredPools) {
  const chatId = msg.chat.id;
  const params = match[1].trim().split(/\s+/);

  // Check if we have any pools monitored in this chat
  const poolsInChat = Object.entries(monitoredPools).filter(
    ([_, poolData]) => poolData.chatId === chatId
  );

  if (poolsInChat.length === 0) {
    bot.sendMessage(chatId, "No pools are currently being monitored in this chat. Send a pool address first.");
    return;
  }

  // Handle both formats: "/notify <price>" and "/notify <pool_address> <price>"
  let targetPrice, poolAddress;

  if (params.length === 1) {
    // Format: "/notify <price>" - applies to all pools in the chat
    targetPrice = parseFloat(params[0]);

    if (isNaN(targetPrice)) {
      bot.sendMessage(chatId, "Invalid price format. Use /notify <price> or /notify <pool_address> <price>");
      return;
    }

    // Apply to all pools in this chat
    let notificationsSet = 0;

    for (const [, poolData] of poolsInChat) {
      if (poolData.lastPriceT1T0) {
        if (!poolData.notifications) {
          poolData.notifications = [];
        }

        poolData.notifications.push({
          targetPrice,
          originalChatId: chatId,
          triggered: false
        });

        notificationsSet++;
      }
    }

    if (notificationsSet > 0) {
      bot.sendMessage(
        chatId,
        `Price alert set at ${targetPrice} for ${notificationsSet} pool(s) in this chat.`
      );
    } else {
      bot.sendMessage(
        chatId,
        "Could not set notifications. Make sure pools are properly initialized."
      );
    }
  } else if (params.length === 2) {
    // Format: "/notify <pool_address> <price>"
    poolAddress = params[0];
    targetPrice = parseFloat(params[1]);

    if (isNaN(targetPrice)) {
      bot.sendMessage(chatId, "Invalid price format. Use /notify <price> or /notify <pool_address> <price>");
      return;
    }

    // Check if the specified pool is being monitored
    if (!monitoredPools[poolAddress] || monitoredPools[poolAddress].chatId !== chatId) {
      bot.sendMessage(chatId, `Pool ${poolAddress} is not monitored in this chat.`);
      return;
    }

    const poolInfo = monitoredPools[poolAddress];

    if (!poolInfo.lastPriceT1T0) {
      bot.sendMessage(chatId, `Pool ${poolAddress} is not initialized yet or price data is not available.`);
      return;
    }

    if (!poolInfo.notifications) {
      poolInfo.notifications = [];
    }

    poolInfo.notifications.push({
      targetPrice,
      originalChatId: chatId,
      triggered: false
    });

    bot.sendMessage(
      chatId,
      `Price alert set at ${targetPrice} for ${poolInfo.token1.symbol}/${poolInfo.token0.symbol} pool.`
    );
  } else {
    bot.sendMessage(chatId, "Invalid format. Use /notify <price> or /notify <pool_address> <price>");
  }
}

module.exports = handleNotify;

/**
 * Handler for /lp command
 * Lists current liquidity pools for monitored wallet along with information about pool,
 * human readable, token amounts, price ranges in token 1 relative to token 0
 */
class LpHandler {
  /**
   * Register command handlers with the bot
   * @param {TelegramBot} bot - The bot instance
   * @param {Object} positionMonitor - Position monitor instance
   * @param {String} timezone - User timezone
   */
  static onText(bot, positionMonitor, timezone) {
    bot.onText(/\/lp/, (msg) => {
      this.handle(bot, msg, positionMonitor, timezone);
    });
  }

  /**
   * Handle lp command
   * @param {TelegramBot} bot - The bot instance
   * @param {Object} msg - Message object from Telegram
   * @param {Object} positionMonitor - Position monitor instance
   * @param {String} timezone - User timezone
   */
  static async handle(bot, msg, positionMonitor, timezone) {
    const chatId = msg.chat.id;

    // Get monitored wallets
    const monitoredWallets = positionMonitor.getMonitoredWallets();

    if (monitoredWallets.length === 0) {
      await bot.sendMessage(chatId, "💼 No wallets are currently being monitored.\n\nUse /wallet <address> to start monitoring a wallet.");
      return;
    }

    // Send initial summary message
    await bot.sendMessage(chatId, `🏊 **Liquidity Positions**\n\nScanning ${monitoredWallets.length} monitored wallet(s)...`, { parse_mode: 'Markdown' });

    try {
      let totalPositions = 0;
      let walletsWithPositions = 0;
      const { getTimeInTimezone } = require('../../../utils/time');

      // Process each wallet and send positions immediately
      for (let walletIndex = 0; walletIndex < monitoredWallets.length; walletIndex++) {
        const walletAddress = monitoredWallets[walletIndex];

        // Send wallet processing message
        await bot.sendMessage(chatId, `💼 **Wallet ${walletIndex + 1}:** \`${walletAddress}\`\n⏳ Loading positions...`, { parse_mode: 'Markdown' });

        const positions = await positionMonitor.getPositions(walletAddress);

        if (positions.length === 0) {
          await bot.sendMessage(chatId, "No active positions found in this wallet.");
        } else {
          walletsWithPositions++;
          totalPositions += positions.length;

          // Send each position as a separate message immediately
          for (let positionIndex = 0; positionIndex < positions.length; positionIndex++) {
            const position = positions[positionIndex];

            if (position.error) {
              await bot.sendMessage(chatId, `❌ **Position #${positionIndex + 1}:** Error - ${position.error}`);
              continue;
            }

            // Use the unified position formatting method
            const positionMessage = positionMonitor.formatSinglePositionMessage(position, timezone, false);

            // Send the position message immediately
            const sentMessage = await bot.sendMessage(chatId, positionMessage, { parse_mode: 'Markdown' });

            // Save position to MongoDB with message ID
            try {
              const positionData = {
                ...position,
                walletAddress: walletAddress,
                poolAddress: await positionMonitor.getPoolAddressForPosition(position)
              };
              await positionMonitor.mongoStateManager.savePosition(positionData, chatId, sentMessage.message_id);
            } catch (saveError) {
              console.error(`Error saving position ${position.tokenId} from /lp command:`, saveError);
            }
          }
        }
      }

      // Send final summary
      let summaryMessage = `📊 **Scan Complete**\n\n`;
      summaryMessage += `• Monitored wallets: ${monitoredWallets.length}\n`;
      summaryMessage += `• Wallets with positions: ${walletsWithPositions}\n`;
      summaryMessage += `• Total positions: ${totalPositions}\n\n`;
      summaryMessage += `🕒 Completed: ${getTimeInTimezone(timezone)}`;

      await bot.sendMessage(chatId, summaryMessage, { parse_mode: 'Markdown' });

    } catch (error) {
      console.error('Error fetching liquidity positions:', error);
      await bot.sendMessage(chatId, `❌ Error fetching liquidity positions: ${error.message}`);
    }
  }

  /**
   * Returns a brief help description with command signature
   * @returns {string} One-line help text
   */
  static help() {
    return "/lp - List current liquidity pools for monitored wallets";
  }
}

module.exports = LpHandler;

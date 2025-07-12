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

    try {
      // Process each wallet
      for (let walletIndex = 0; walletIndex < monitoredWallets.length; walletIndex++) {
        const walletAddress = monitoredWallets[walletIndex];

        // Send initial wallet message with loading status
        const loadingMessage = await bot.sendMessage(
          chatId,
          `💼 **Wallet ${walletIndex + 1}:** \`${walletAddress}\`\n⏳ Loading positions...`,
          { parse_mode: 'Markdown' }
        );

        // Get positions for this wallet
        const positions = await positionMonitor.getPositions(walletAddress);

        if (positions.length === 0) {
          // Replace loading message with "no positions" message
          await bot.editMessageText(
            "No active positions found in this wallet.",
            {
              chat_id: chatId,
              message_id: loadingMessage.message_id,
              parse_mode: 'Markdown',
              disable_web_page_preview: true
            }
          );
        } else {
          // Process each position
          for (let positionIndex = 0; positionIndex < positions.length; positionIndex++) {
            const position = positions[positionIndex];

            if (position.error) {
              const errorMessage = `❌ **Position #${positionIndex + 1}:** Error - ${position.error}`;

              if (positionIndex === 0) {
                // Replace loading message with first position error
                await bot.editMessageText(
                  errorMessage,
                  {
                    chat_id: chatId,
                    message_id: loadingMessage.message_id,
                    parse_mode: 'Markdown',
                    disable_web_page_preview: true
                  }
                );
              } else {
                // Send as separate message
                await bot.sendMessage(chatId, errorMessage, { parse_mode: 'Markdown' });
              }
              continue;
            }

            // Use the unified position formatting method
            const positionMessage = positionMonitor.formatSinglePositionMessage(position, timezone, false);

            let sentMessage;
            if (positionIndex === 0) {
              // Replace loading message with first position
              await bot.editMessageText(
                positionMessage,
                {
                  chat_id: chatId,
                  message_id: loadingMessage.message_id,
                  parse_mode: 'Markdown',
                  disable_web_page_preview: true
                }
              );
              sentMessage = { message_id: loadingMessage.message_id };
            } else {
              // Send additional positions as separate messages
              sentMessage = await bot.sendMessage(chatId, positionMessage, { parse_mode: 'Markdown' });
            }

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

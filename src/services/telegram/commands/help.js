const StartHandler = require('./start');
const { PoolHandler } = require('./pool');
const WalletHandler = require('./wallet');
const { LpHandler } = require('./lp');

/**
 * Represents a help message with its content and formatting
 */
class HelpMessage {
  /**
   * Create a help message instance
   */
  constructor(chatId) {
    this.chatId = chatId;
    this.allHandlers = [
      StartHandler,
      PoolHandler,
      WalletHandler,
      LpHandler,
      HelpHandler  // Include self for completeness
    ];
  }

  /**
   * Get the formatted help message content
   * @returns {string} The complete formatted help message
   */
  toString() {
    const title = `🤖 **Bot Commands Help**\n\n`;
    const availableCommands = `**Available Commands:**\n`;

    const commandsList = this._getCommandsList();
    const detailedHelp = this._getDetailedHelp();

    let finalMessage = title + availableCommands + commandsList;

    if (detailedHelp) {
      finalMessage += `\n**Detailed Information:**\n${detailedHelp}`;
    }

    return finalMessage;
  }

  getOptions() {
    return {
      parse_mode: 'Markdown',
      disable_web_page_preview: true
    }
  }

  /**
   * Get the commands list section
   * @returns {string} Commands list content
   */
  _getCommandsList() {
    let commandsList = '';

    this.allHandlers.forEach(handler => {
      if (handler && typeof handler.help === 'function') {
        commandsList += `• ${handler.help()}\n`;
      }
    });

    return commandsList;
  }

  /**
   * Get the detailed help section
   * @returns {string} Detailed help content
   */
  _getDetailedHelp() {
    let detailedHelp = '';

    this.allHandlers.forEach(handler => {
      if (handler && typeof handler.usage === 'function') {
        detailedHelp += `\n${handler.usage()}\n\n`;
      }
    });

    return detailedHelp;
  }
}

class HelpHandler {
    static command = '/help';
    static description = 'Show help information for all commands';

    /**
     * Create a new HelpHandler instance
     * @param {TelegramBot} bot - The bot instance
     */
    constructor(bot) {
      this.bot = bot;
      this.registerHandlers();
    }

    /**
     * Register command handlers with the bot
     */
    registerHandlers() {
        this.bot.onText(/\/help/, (msg) => {
            return this.handle(msg);
        });
    }

    /**
     * Handle the help command
     * @param {Object} msg - Message object
     */
    async handle(msg) {
        try {
            const helpMessage = new HelpMessage(msg.chat.id);
            await this.bot.send(helpMessage);
        } catch (error) {
            console.error('Error in help command:', error);
            await this.bot.sendMessage(msg.chat.id, 'Sorry, there was an error displaying help information.');
        }
    }

    /**
     * Returns a brief help description with command signatusre
     * @returns {string} One-line help text
     */
    static help() {
        return "/help - Show this help message with all available commands";
    }

    /**
     * Returns detailed usage information for the help command
     * @returns {string} Help text for humans
     */
    static usage() {
        return `❓ **Help Command Help**

**Usage:**
\`/help\` - Display all available commands and their usage

**Description:**
Shows a comprehensive list of all bot commands with their descriptions and usage examples.

**Notes:**
• This command lists all available bot functionality
• Each command includes usage examples and descriptions
• Commands are organized by category for easy reference`;
    }
}

module.exports = HelpHandler;

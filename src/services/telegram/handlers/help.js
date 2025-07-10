const StartHandler = require('./start');
const PoolHandler = require('./pool');
const WalletHandler = require('./wallet');
const NotifyHandler = require('./notify');

class HelpHandler {
    static command = '/help';
    static description = 'Show help information for all commands';

    /**
     * Register command handlers with the bot
     * @param {TelegramBot} bot - The bot instance
     */
    static onText(bot) {
        bot.onText(/\/help/, (msg) => {
            this.handle(bot, msg);
        });
    }

    /**
     * Handle the help command
     * @param {TelegramBot} bot - The bot instance
     * @param {Object} msg - Message object
     * @param {Array} args - Command arguments
     */
    static async handle(bot, msg, args) {
        try {
            const helpMessage = this.buildHelpMessage();
            await bot.sendMessage(msg.chat.id, helpMessage, {
                parse_mode: 'Markdown',
                disable_web_page_preview: true
            });
        } catch (error) {
            console.error('Error in help command:', error);
            await bot.sendMessage(msg.chat.id, 'Sorry, there was an error displaying help information.');
        }
    }

    /**
     * Build the complete help message by calling Help() for each handler
     * @returns {string} Complete help message
     */
    static buildHelpMessage() {
        const title = `🤖 **Bot Commands Help**\n\n`;
        const availableCommands = `**Available Commands:**\n`;

        let commandsList = '';
        let detailedHelp = '';

        // List of all handlers - update this list when adding new handlers
        const allHandlers = [
            StartHandler,
            PoolHandler,
            WalletHandler,
            NotifyHandler,
            HelpHandler  // Include self for completeness
        ];

        allHandlers.forEach(handler => {
            if (handler && typeof handler.help === 'function') {
                // Add to commands list
                commandsList += `• ${handler.help()}\n`;

                // Add detailed usage if available
                if (typeof handler.usage === 'function') {
                    detailedHelp += `\n${handler.usage()}\n\n`;
                }
            }
        });

        // Build final message
        let finalMessage = title + availableCommands + commandsList;

        if (detailedHelp) {
            finalMessage += `\n**Detailed Information:**\n${detailedHelp}`;
        }

        // Add footer
        finalMessage += `\n**Tips:**\n`;
        finalMessage += `• Use /help to see this message again\n`;

        return finalMessage;
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

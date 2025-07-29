/**
 * Wallet Registry
 * Handles wallet monitoring and persistence
 */

class WalletRegistry {
  /**
   * Create a new WalletRegistry instance
   */
  constructor(walletModel) {
    this.walletModel = walletModel;
    this.monitoredWallets = new Map(); // chatId -> Set of wallet addresses
  }

  /**
   * Add a wallet to monitoring for a specific chat
   * @param {string} walletAddress - Wallet address to monitor
   * @param {number} chatId - Telegram chat ID
   * @returns {Promise<boolean>} - True if wallet was added, false if already monitored
   */
  async addWallet(walletAddress, chatId) {
    const normalizedAddress = walletAddress.toLowerCase();

    // Check if wallet is already monitored for this chat
    if (!this.monitoredWallets.has(chatId)) {
      this.monitoredWallets.set(chatId, new Set());
    }

    const chatWallets = this.monitoredWallets.get(chatId);
    const isAlreadyMonitored = chatWallets.has(normalizedAddress);

    if (!isAlreadyMonitored) {
      chatWallets.add(normalizedAddress);

      // Persist to database
      await this.saveWalletToDatabase(normalizedAddress, chatId);
    }

    return !isAlreadyMonitored;
  }

  /**
   * Remove a wallet from monitoring for a specific chat
   * @param {string} walletAddress - Wallet address to stop monitoring
   * @param {number} chatId - Telegram chat ID
   * @returns {Promise<boolean>} - True if wallet was removed, false if not found
   */
  async removeWallet(walletAddress, chatId) {
    const normalizedAddress = walletAddress.toLowerCase();

    if (!this.monitoredWallets.has(chatId)) {
      return false;
    }

    const chatWallets = this.monitoredWallets.get(chatId);
    const wasRemoved = chatWallets.delete(normalizedAddress);

    if (wasRemoved) {
      // Remove from database
      await this.removeWalletFromDatabase(normalizedAddress, chatId);

      // Clean up empty chat entries
      if (chatWallets.size === 0) {
        this.monitoredWallets.delete(chatId);
      }
    }

    return wasRemoved;
  }

  /**
   * Get all monitored wallets for a specific chat
   * @param {number} chatId - Telegram chat ID
   * @returns {Array<string>} - Array of wallet addresses
   */
  getWalletsForChat(chatId) {
    if (!this.monitoredWallets.has(chatId)) {
      return [];
    }

    return Array.from(this.monitoredWallets.get(chatId));
  }

  /**
   * Get all monitored wallets across all chats
   * @returns {Array<string>} - Array of unique wallet addresses
   */
  getAllMonitoredWallets() {
    const allWallets = new Set();

    for (const chatWallets of this.monitoredWallets.values()) {
      for (const wallet of chatWallets) {
        allWallets.add(wallet);
      }
    }

    return Array.from(allWallets);
  }

  /**
   * Check if a wallet is being monitored for a specific chat
   * @param {string} walletAddress - Wallet address to check
   * @param {number} chatId - Telegram chat ID
   * @returns {boolean} - True if wallet is monitored
   */
  isWalletMonitored(walletAddress, chatId) {
    const normalizedAddress = walletAddress.toLowerCase();

    if (!this.monitoredWallets.has(chatId)) {
      return false;
    }

    return this.monitoredWallets.get(chatId).has(normalizedAddress);
  }

  /**
   * Get all chats monitoring a specific wallet
   * @param {string} walletAddress - Wallet address
   * @returns {Array<number>} - Array of chat IDs
   */
  getChatsForWallet(walletAddress) {
    const normalizedAddress = walletAddress.toLowerCase();
    const chats = [];

    for (const [chatId, wallets] of this.monitoredWallets.entries()) {
      if (wallets.has(normalizedAddress)) {
        chats.push(chatId);
      }
    }

    return chats;
  }

  /**
   * Load wallets from database on startup
   * @returns {Promise<void>}
   */
  async loadWalletsFromDatabase() {
    try {
      const wallets = await this.walletModel.getAllMonitoredWallets();

      for (const wallet of wallets) {
        if (!this.monitoredWallets.has(wallet.chatId)) {
          this.monitoredWallets.set(wallet.chatId, new Set());
        }

        this.monitoredWallets.get(wallet.chatId).add(wallet.address.toLowerCase());
      }

      console.log(`Loaded ${wallets.length} monitored wallets from database`);
    } catch (error) {
      console.error('Error loading wallets from database:', error);
    }
  }

  /**
   * Save wallet to database
   * @param {string} walletAddress - Wallet address
   * @param {number} chatId - Telegram chat ID
   * @returns {Promise<void>}
   * @private
   */
  async saveWalletToDatabase(walletAddress, chatId) {
    try {
      if (!this.walletModel.isConnected) {
        await this.walletModel.connect();
      }

      await this.walletModel.saveMonitoredWallet(walletAddress, chatId);
    } catch (error) {
      console.error('Error saving wallet to database:', error);
      throw error;
    }
  }

  /**
   * Remove wallet from database
   * @param {string} walletAddress - Wallet address
   * @param {number} chatId - Telegram chat ID
   * @returns {Promise<void>}
   * @private
   */
  async removeWalletFromDatabase(walletAddress, chatId) {
    try {
      if (!this.walletModel.isConnected) {
        await this.walletModel.connect();
      }

      await this.walletModel.removeMonitoredWallet(walletAddress, chatId);
    } catch (error) {
      console.error('Error removing wallet from database:', error);
      throw error;
    }
  }

  /**
   * Get wallet statistics
   * @returns {Object} - Statistics about monitored wallets
   */
  getStatistics() {
    const totalChats = this.monitoredWallets.size;
    const totalWallets = this.getAllMonitoredWallets().length;
    let totalWalletChatPairs = 0;

    for (const wallets of this.monitoredWallets.values()) {
      totalWalletChatPairs += wallets.size;
    }

    return {
      totalChats,
      totalWallets,
      totalWalletChatPairs,
      averageWalletsPerChat: totalChats > 0 ? (totalWalletChatPairs / totalChats).toFixed(2) : 0
    };
  }
}

module.exports = WalletRegistry;

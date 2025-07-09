/**
 * MongoDB State Manager
 * Handles persistence of monitoring state to MongoDB
 */
const { MongoClient } = require('mongodb');

class MongoStateManager {
  constructor() {
    this.client = null;
    this.db = null;
    this.collection = null;
    this.isConnected = false;
  }

  /**
   * Connect to MongoDB
   */
  async connect() {
    try {
      const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/defi-lp-manager';
      this.client = new MongoClient(uri);

      await this.client.connect();
      this.db = this.client.db();
      this.collection = this.db.collection('monitored_pools');
      this.isConnected = true;

      console.log('Connected to MongoDB');
    } catch (error) {
      console.error('Failed to connect to MongoDB:', error.message);
      this.isConnected = false;
    }
  }

  /**
   * Save state for a specific pool
   * @param {string} poolAddress - Address of the pool
   * @param {Object} poolData - Data to save
   */
  async savePoolState(poolAddress, poolData) {
    if (!this.isConnected) {
      console.warn('Cannot save pool state: Not connected to MongoDB');
      return;
    }

    try {
      // Clean non-serializable data
      const stateData = {
        poolAddress,
        token0: poolData.token0,
        token1: poolData.token1,
        chatId: poolData.chatId,
        messageId: poolData.messageId,
        lastPriceT1T0: poolData.lastPriceT1T0,
        notifications: poolData.notifications || [],
        updatedAt: new Date()
      };

      await this.collection.replaceOne(
        { poolAddress },
        stateData,
        { upsert: true }
      );
    } catch (error) {
      console.error(`Error saving state for pool ${poolAddress}:`, error.message);
    }
  }

  /**
   * Save state for all pools
   * @param {Object} monitoredPools - All pools data
   */
  async saveAllPools(monitoredPools) {
    if (!this.isConnected) {
      console.warn('Cannot save all pools: Not connected to MongoDB');
      return;
    }

    try {
      for (const [poolAddress, poolData] of Object.entries(monitoredPools)) {
        await this.savePoolState(poolAddress, poolData);
      }
      console.log(`Saved state for ${Object.keys(monitoredPools).length} pools`);
    } catch (error) {
      console.error('Error saving all pools:', error.message);
    }
  }

  /**
   * Load all saved pools
   * @returns {Object} Saved pool data
   */
  async loadAllPools() {
    if (!this.isConnected) {
      console.warn('Cannot load pools: Not connected to MongoDB');
      return {};
    }

    try {
      const pools = await this.collection.find({}).toArray();
      const result = {};

      pools.forEach(pool => {
        const { poolAddress, ...poolData } = pool;
        result[poolAddress] = poolData;
      });

      console.log(`Loaded ${pools.length} pools from database`);
      return result;
    } catch (error) {
      console.error('Error loading pools:', error.message);
      return {};
    }
  }

  /**
   * Remove a pool from the database
   * @param {string} poolAddress - Address of the pool to remove
   */
  async removePool(poolAddress) {
    if (!this.isConnected) {
      console.warn('Cannot remove pool: Not connected to MongoDB');
      return;
    }

    try {
      await this.collection.deleteOne({ poolAddress });
      console.log(`Removed pool ${poolAddress} from database`);
    } catch (error) {
      console.error(`Error removing pool ${poolAddress}:`, error.message);
    }
  }

  /**
   * Close the MongoDB connection
   */
  async close() {
    if (this.client) {
      await this.client.close();
      this.isConnected = false;
      console.log('MongoDB connection closed');
    }
  }
}

module.exports = MongoStateManager;

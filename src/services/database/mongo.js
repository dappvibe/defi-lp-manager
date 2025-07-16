/**
 * MongoDB State Manager
 * Handles persistence of database state to MongoDB
 */
const { MongoClient } = require('mongodb');

class Mongo {
  static #instance = null;

  static getInstance() {
    if (!Mongo.#instance) {
      Mongo.#instance = new Mongo();
    }
    return Mongo.#instance;
  }

  constructor() {
    if (Mongo.#instance) {
      throw new Error('Use Mongo.getInstance() instead of new operator');
    }
    this.client = null;
    this.db = null;
    this.poolsCollection = null;
    this.walletsCollection = null;
    this.positionsCollection = null;
    this.poolMessagesCollection = null;
    this.isConnected = false;
  }

  /**
   * Connect to MongoDB
   */
  async connect() {
    if (this.isConnected && this.client) return;

    try {
      const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/defi-lp-manager';
      this.client = new MongoClient(uri);

      await this.client.connect();
      this.db = this.client.db();
      this.poolsCollection = this.db.collection('pools');
      this.walletsCollection = this.db.collection('monitored_wallets');
      this.positionsCollection = this.db.collection('positions');
      this.poolMessagesCollection = this.db.collection('pool_messages');
      this.isConnected = true;

      // Create indexes for efficient token-based filtering
      await this.createTokenIndexes();

      console.log('Connected to MongoDB');
    } catch (error) {
      console.error('Failed to connect to MongoDB:', error.message);
      this.isConnected = false;
    }
  }

  /**
   * Create database indexes for efficient token-based filtering
   */
  async createTokenIndexes() {
    try {
      // Indexes for unified pools collection to support token filtering
      await this.poolsCollection.createIndex({ 'token0.address': 1 });
      await this.poolsCollection.createIndex({ 'token1.address': 1 });
      await this.poolsCollection.createIndex({ 'token0.symbol': 1 });
      await this.poolsCollection.createIndex({ 'token1.symbol': 1 });

      // Compound indexes for efficient multi-token queries
      await this.poolsCollection.createIndex({
        'token0.address': 1,
        'token1.address': 1
      });
      await this.poolsCollection.createIndex({
        'token0.symbol': 1,
        'token1.symbol': 1
      });

      // Indexes for platform and blockchain filtering
      await this.poolsCollection.createIndex({ 'platform': 1 });
      await this.poolsCollection.createIndex({ 'blockchain': 1 });
      await this.poolsCollection.createIndex({
        'platform': 1,
        'blockchain': 1
      });

      // Index for pool address (primary key)
      await this.poolsCollection.createIndex({ 'poolAddress': 1 });

      // Indexes for positions collection
      await this.positionsCollection.createIndex({ 'tokenId': 1 });
      await this.positionsCollection.createIndex({ 'walletAddress': 1 });
      await this.positionsCollection.createIndex({ 'poolAddress': 1 });
      await this.positionsCollection.createIndex({ 'chatId': 1 });
      await this.positionsCollection.createIndex({ 'messageId': 1 });
      await this.positionsCollection.createIndex({
        'walletAddress': 1,
        'tokenId': 1
      });

      // Indexes for pool messages collection
      await this.poolMessagesCollection.createIndex({ 'poolAddress': 1 });
      await this.poolMessagesCollection.createIndex({ 'chatId': 1 });
      await this.poolMessagesCollection.createIndex({ 'messageId': 1 });
      await this.poolMessagesCollection.createIndex({
        'poolAddress': 1,
        'chatId': 1
      });

      console.log('Created database indexes for unified pools collection, positions, and pool messages');
    } catch (error) {
      console.warn('Warning: Could not create token indexes:', error.message);
    }
  }

  /**
   * Save pool information (both static and monitoring state)
   * @param {string} poolAddress - Address of the pool
   * @param {Object} poolData - Data to save
   */
  async savePoolState(poolAddress, poolData) {
    if (!this.isConnected) {
      console.warn('Cannot save pool state: Not connected to MongoDB');
      return;
    }

    try {
      // Get existing pool data to preserve static information
      const existingPool = await this.poolsCollection.findOne({ poolAddress });

      // Prepare unified data combining static info and monitoring state
      const unifiedData = {
        poolAddress,
        // Static pool information (immutable)
        token0: poolData.token0 || existingPool?.token0,
        token1: poolData.token1 || existingPool?.token1,
        fee: poolData.fee || existingPool?.fee,
        tickSpacing: poolData.tickSpacing || existingPool?.tickSpacing,
        sqrtPriceX96: poolData.sqrtPriceX96 || existingPool?.sqrtPriceX96,
        tick: poolData.tick || existingPool?.tick,
        observationIndex: poolData.observationIndex || existingPool?.observationIndex,
        observationCardinality: poolData.observationCardinality || existingPool?.observationCardinality,
        observationCardinalityNext: poolData.observationCardinalityNext || existingPool?.observationCardinalityNext,
        feeProtocol: poolData.feeProtocol || existingPool?.feeProtocol,
        unlocked: poolData.unlocked || existingPool?.unlocked,
        // Metadata
        platform: poolData.platform || existingPool?.platform,
        blockchain: poolData.blockchain || existingPool?.blockchain,
        configName: poolData.configName || existingPool?.configName,
        configDescription: poolData.configDescription || existingPool?.configDescription,
        // Monitoring state (moved to pool messages collection)
        lastPriceT1T0: poolData.lastPriceT1T0,
        notifications: poolData.notifications || [],
        priceMonitoringEnabled: poolData.priceMonitoringEnabled || false,
        // Timestamps
        cachedAt: existingPool?.cachedAt || new Date(),
        updatedAt: new Date()
      };

      await this.poolsCollection.replaceOne(
        { poolAddress },
        unifiedData,
        { upsert: true }
      );
    } catch (error) {
      console.error(`Error saving pool data for ${poolAddress}:`, error.message);
    }
  }

  /**
   * Save pool message information
   * @param {string} poolAddress - Address of the pool
   * @param {number} chatId - Chat ID
   * @param {number} messageId - Message ID
   * @param {boolean} isMonitored - Whether the pool is being monitored
   */
  async savePoolMessage(poolAddress, chatId, messageId, isMonitored = true) {
    if (!this.isConnected) {
      console.warn('Cannot save pool message: Not connected to MongoDB');
      return;
    }

    try {
      const poolMessage = {
        poolAddress,
        chatId,
        messageId,
        isMonitored,
        createdAt: new Date(),
        updatedAt: new Date()
      };

      await this.poolMessagesCollection.replaceOne(
        { poolAddress, chatId },
        poolMessage,
        { upsert: true }
      );
    } catch (error) {
      console.error(`Error saving pool message for ${poolAddress}:`, error.message);
    }
  }

  /**
   * Get pool message information
   * @param {string} poolAddress - Address of the pool
   * @param {number} chatId - Chat ID
   * @returns {Object|null} Pool message data or null if not found
   */
  async getPoolMessage(poolAddress, chatId) {
    if (!this.isConnected) {
      console.warn('Cannot get pool message: Not connected to MongoDB');
      return null;
    }

    try {
      const poolMessage = await this.poolMessagesCollection.findOne({
        poolAddress,
        chatId
      });

      return poolMessage;
    } catch (error) {
      console.error(`Error getting pool message for ${poolAddress}:`, error.message);
      return null;
    }
  }

  /**
   * Get all monitored pool messages
   * @returns {Array} Array of monitored pool messages
   */
  async getMonitoredPoolMessages() {
    if (!this.isConnected) {
      console.warn('Cannot get monitored pool messages: Not connected to MongoDB');
      return [];
    }

    try {
      const monitoredPools = await this.poolMessagesCollection.find({
        isMonitored: true
      }).toArray();

      return monitoredPools;
    } catch (error) {
      console.error('Error getting monitored pool messages:', error.message);
      return [];
    }
  }

  /**
   * Remove pool message information
   * @param {string} poolAddress - Address of the pool
   * @param {number} chatId - Chat ID
   */
  async removePoolMessage(poolAddress, chatId) {
    if (!this.isConnected) {
      console.warn('Cannot remove pool message: Not connected to MongoDB');
      return;
    }

    try {
      await this.poolMessagesCollection.deleteOne({
        poolAddress,
        chatId
      });

      console.log(`Removed pool message for ${poolAddress} in chat ${chatId}`);
    } catch (error) {
      console.error(`Error removing pool message for ${poolAddress}:`, error.message);
    }
  }

  /**
   * Update pool message ID
   * @param {string} poolAddress - Address of the pool
   * @param {number} chatId - Chat ID
   * @param {number} messageId - New message ID
   */
  async updatePoolMessageId(poolAddress, chatId, messageId) {
    if (!this.isConnected) {
      console.warn('Cannot update pool message ID: Not connected to MongoDB');
      return;
    }

    try {
      await this.poolMessagesCollection.updateOne(
        { poolAddress, chatId },
        {
          $set: {
            messageId,
            updatedAt: new Date()
          }
        }
      );

      console.log(`Updated message ID for pool message ${poolAddress} in chat ${chatId}`);
    } catch (error) {
      console.error(`Error updating pool message ID for ${poolAddress}:`, error.message);
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
      const pools = await this.poolsCollection.find({}).toArray();
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
      await this.poolsCollection.deleteOne({ poolAddress });
      console.log(`Removed pool ${poolAddress} from database`);
    } catch (error) {
      console.error(`Error removing pool ${poolAddress}:`, error.message);
    }
  }

  /**
   * Cache pool static information (tokens, fee, etc.)
   * @param {string} poolAddress - Address of the pool
   * @param {Object} poolInfo - Static pool information
   */
  async cachePoolInfo(poolAddress, poolInfo) {
    // Use the unified savePoolState method
    await this.savePoolState(poolAddress, poolInfo);
    console.log(`Cached static info for pool ${poolAddress}`);
  }

  /**
   * Get cached pool static information
   * @param {string} poolAddress - Address of the pool
   * @returns {Object|null} Cached pool information or null if not found
   */
  async getCachedPoolInfo(poolAddress) {
    if (!this.isConnected) {
      console.warn('Cannot get cached pool info: Not connected to MongoDB');
      return null;
    }

    try {
      const poolInfo = await this.poolsCollection.findOne({ poolAddress });
      if (poolInfo) {
        console.log(`Retrieved pool info for ${poolAddress}`);
        return poolInfo;
      }
      return null;
    } catch (error) {
      console.error(`Error retrieving pool info for ${poolAddress}:`, error.message);
      return null;
    }
  }

  /**
   * Get all cached pool information
   * @returns {Array} Array of cached pool information
   */
  async getAllCachedPools() {
    if (!this.isConnected) {
      console.warn('Cannot get all cached pools: Not connected to MongoDB');
      return [];
    }

    try {
      const pools = await this.poolsCollection.find({}).toArray();
      console.log(`Retrieved ${pools.length} pools`);
      return pools;
    } catch (error) {
      console.error('Error retrieving all pools:', error.message);
      return [];
    }
  }

  /**
   * Remove cached pool information
   * @param {string} poolAddress - Address of the pool
   */
  async removeCachedPoolInfo(poolAddress) {
    // Use the unified removePool method
    await this.removePool(poolAddress);
  }

  /**
   * Find pools by token address (either token0 or token1)
   * @param {string} tokenAddress - Token contract address
   * @returns {Array} Array of pools containing the specified token
   */
  async findPoolsByTokenAddress(tokenAddress) {
    if (!this.isConnected) {
      console.warn('Cannot find pools by token: Not connected to MongoDB');
      return [];
    }

    try {
      const query = {
        $or: [
          { 'token0.address': tokenAddress.toLowerCase() },
          { 'token1.address': tokenAddress.toLowerCase() }
        ]
      };

      const pools = await this.poolsCollection.find(query).toArray();
      console.log(`Found ${pools.length} pools containing token ${tokenAddress}`);
      return pools;
    } catch (error) {
      console.error(`Error finding pools by token ${tokenAddress}:`, error.message);
      return [];
    }
  }

  /**
   * Find pools by token symbol (either token0 or token1)
   * @param {string} tokenSymbol - Token symbol
   * @returns {Array} Array of pools containing the specified token
   */
  async findPoolsByTokenSymbol(tokenSymbol) {
    if (!this.isConnected) {
      console.warn('Cannot find pools by token symbol: Not connected to MongoDB');
      return [];
    }

    try {
      const query = {
        $or: [
          { 'token0.symbol': { $regex: new RegExp(tokenSymbol, 'i') } },
          { 'token1.symbol': { $regex: new RegExp(tokenSymbol, 'i') } }
        ]
      };

      const pools = await this.poolsCollection.find(query).toArray();
      console.log(`Found ${pools.length} pools containing token symbol ${tokenSymbol}`);
      return pools;
    } catch (error) {
      console.error(`Error finding pools by token symbol ${tokenSymbol}:`, error.message);
      return [];
    }
  }

  /**
   * Find pools by platform and blockchain
   * @param {string} platform - Platform name (e.g., 'pancakeswap')
   * @param {string} blockchain - Blockchain name (e.g., 'arbitrum')
   * @returns {Array} Array of pools on the specified platform and blockchain
   */
  async findPoolsByPlatformAndBlockchain(platform, blockchain) {
    if (!this.isConnected) {
      console.warn('Cannot find pools by platform and blockchain: Not connected to MongoDB');
      return [];
    }

    try {
      const query = {
        platform: platform.toLowerCase(),
        blockchain: blockchain.toLowerCase()
      };

      const pools = await this.poolsCollection.find(query).toArray();
      console.log(`Found ${pools.length} pools on ${platform} ${blockchain}`);
      return pools;
    } catch (error) {
      console.error(`Error finding pools by platform and blockchain:`, error.message);
      return [];
    }
  }

  /**
   * Save position information
   * @param {Object} position - Position data
   */
  async savePosition(position) {
    if (!this.isConnected) {
      console.warn('Cannot save position: Not connected to MongoDB');
      return;
    }

    try {
      const { tokenId, walletAddress, ...positionData } = position;
      const positionDoc = {
        tokenId,
        walletAddress,
        ...positionData,
        updatedAt: new Date()
      };

      await this.positionsCollection.replaceOne(
        { tokenId, walletAddress },
        positionDoc,
        { upsert: true }
      );

      console.log(`Saved position ${tokenId} for wallet ${walletAddress}`);
    } catch (error) {
      console.error(`Error saving position ${position.tokenId}:`, error.message);
    }
  }

  /**
   * Get position information
   * @param {string} tokenId - Token ID
   * @param {string} walletAddress - Wallet address
   * @returns {Object|null} Position data or null if not found
   */
  async getPosition(tokenId, walletAddress) {
    if (!this.isConnected) {
      console.warn('Cannot get position: Not connected to MongoDB');
      return null;
    }

    try {
      const position = await this.positionsCollection.findOne({
        tokenId,
        walletAddress
      });

      return position;
    } catch (error) {
      console.error(`Error getting position ${tokenId}:`, error.message);
      return null;
    }
  }

  /**
   * Get all positions for a wallet
   * @param {string} walletAddress - Wallet address
   * @returns {Array} Array of positions
   */
  async getPositionsByWallet(walletAddress) {
    if (!this.isConnected) {
      console.warn('Cannot get positions by wallet: Not connected to MongoDB');
      return [];
    }

    try {
      const positions = await this.positionsCollection.find({
        walletAddress
      }).toArray();

      return positions;
    } catch (error) {
      console.error(`Error getting positions for wallet ${walletAddress}:`, error.message);
      return [];
    }
  }

  /**
   * Remove position information
   * @param {string} tokenId - Token ID
   * @param {string} walletAddress - Wallet address
   */
  async removePosition(tokenId, walletAddress) {
    if (!this.isConnected) {
      console.warn('Cannot remove position: Not connected to MongoDB');
      return;
    }

    try {
      await this.positionsCollection.deleteOne({
        tokenId,
        walletAddress
      });

      console.log(`Removed position ${tokenId} for wallet ${walletAddress}`);
    } catch (error) {
      console.error(`Error removing position ${tokenId}:`, error.message);
    }
  }

  /**
   * Close MongoDB connection
   */
  async disconnect() {
    if (this.client) {
      await this.client.close();
      this.isConnected = false;
      console.log('Disconnected from MongoDB');
    }
  }
}

module.exports = {
  mongo: Mongo.getInstance()
};

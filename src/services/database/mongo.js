/**
 * MongoDB State Manager
 * Handles persistence of database state to MongoDB
 */
const { MongoClient } = require('mongodb');

class Mongo {
  constructor() {
    this.client = null;
    this.db = null;
    this.poolsCollection = null;
    this.walletsCollection = null;
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
      this.poolsCollection = this.db.collection('pools');
      this.walletsCollection = this.db.collection('monitored_wallets');
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

      console.log('Created database indexes for unified pools collection');
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
        // Monitoring state (optional, only present for monitored pools)
        chatId: poolData.chatId,
        messageId: poolData.messageId,
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
      console.error(`Error finding pools by token address ${tokenAddress}:`, error.message);
      return [];
    }
  }

  /**
   * Find pools by token symbol (either token0 or token1)
   * @param {string} tokenSymbol - Token symbol (e.g., 'ETH', 'USDC')
   * @returns {Array} Array of pools containing the specified token symbol
   */
  async findPoolsByTokenSymbol(tokenSymbol) {
    if (!this.isConnected) {
      console.warn('Cannot find pools by token symbol: Not connected to MongoDB');
      return [];
    }

    try {
      const query = {
        $or: [
          { 'token0.symbol': { $regex: new RegExp(`^${tokenSymbol}$`, 'i') } },
          { 'token1.symbol': { $regex: new RegExp(`^${tokenSymbol}$`, 'i') } }
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
   * Find pools by token pair (both token addresses)
   * @param {string} token0Address - First token address
   * @param {string} token1Address - Second token address
   * @returns {Array} Array of pools containing the specified token pair
   */
  async findPoolsByTokenPair(token0Address, token1Address) {
    if (!this.isConnected) {
      console.warn('Cannot find pools by token pair: Not connected to MongoDB');
      return [];
    }

    try {
      const query = {
        $or: [
          {
            'token0.address': token0Address.toLowerCase(),
            'token1.address': token1Address.toLowerCase()
          },
          {
            'token0.address': token1Address.toLowerCase(),
            'token1.address': token0Address.toLowerCase()
          }
        ]
      };

      const pools = await this.poolsCollection.find(query).toArray();
      console.log(`Found ${pools.length} pools for token pair ${token0Address}/${token1Address}`);
      return pools;
    } catch (error) {
      console.error(`Error finding pools by token pair ${token0Address}/${token1Address}:`, error.message);
      return [];
    }
  }

  /**
   * Find pools by token symbol pair
   * @param {string} symbol0 - First token symbol
   * @param {string} symbol1 - Second token symbol
   * @returns {Array} Array of pools containing the specified token symbol pair
   */
  async findPoolsByTokenSymbolPair(symbol0, symbol1) {
    if (!this.isConnected) {
      console.warn('Cannot find pools by token symbol pair: Not connected to MongoDB');
      return [];
    }

    try {
      const query = {
        $or: [
          {
            'token0.symbol': { $regex: new RegExp(`^${symbol0}$`, 'i') },
            'token1.symbol': { $regex: new RegExp(`^${symbol1}$`, 'i') }
          },
          {
            'token0.symbol': { $regex: new RegExp(`^${symbol1}$`, 'i') },
            'token1.symbol': { $regex: new RegExp(`^${symbol0}$`, 'i') }
          }
        ]
      };

      const pools = await this.poolsCollection.find(query).toArray();
      console.log(`Found ${pools.length} pools for token symbol pair ${symbol0}/${symbol1}`);
      return pools;
    } catch (error) {
      console.error(`Error finding pools by token symbol pair ${symbol0}/${symbol1}:`, error.message);
      return [];
    }
  }

  /**
   * Get all unique tokens from cached pools
   * @returns {Array} Array of unique token objects with address and symbol
   */
  async getAllUniqueTokens() {
    if (!this.isConnected) {
      console.warn('Cannot get unique tokens: Not connected to MongoDB');
      return [];
    }

    try {
      const pipeline = [
        {
          $project: {
            tokens: [
              { address: '$token0.address', symbol: '$token0.symbol', decimals: '$token0.decimals' },
              { address: '$token1.address', symbol: '$token1.symbol', decimals: '$token1.decimals' }
            ]
          }
        },
        { $unwind: '$tokens' },
        {
          $group: {
            _id: '$tokens.address',
            address: { $first: '$tokens.address' },
            symbol: { $first: '$tokens.symbol' },
            decimals: { $first: '$tokens.decimals' }
          }
        },
        { $sort: { symbol: 1 } }
      ];

      const tokens = await this.poolsCollection.aggregate(pipeline).toArray();
      console.log(`Found ${tokens.length} unique tokens`);
      return tokens.map(token => ({
        address: token.address,
        symbol: token.symbol,
        decimals: token.decimals
      }));
    } catch (error) {
      console.error('Error getting unique tokens:', error.message);
      return [];
    }
  }

  /**
   * Save monitored wallets to database
   * @param {Map} monitoredWallets - Map of wallet addresses to database data
   */
  async saveMonitoredWallets(monitoredWallets) {
    if (!this.isConnected) {
      console.warn('Cannot save monitored wallets: Not connected to MongoDB');
      return;
    }

    try {
      // Clear previous wallets
      await this.walletsCollection.deleteMany({});

      // Convert Map to array for storage
      const walletsArray = Array.from(monitoredWallets.entries()).map(([address, data]) => ({
        walletAddress: address,
        chatId: data.chatId,
        lastCheck: data.lastCheck,
        updatedAt: new Date()
      }));

      // Insert all wallets if there are any
      if (walletsArray.length > 0) {
        await this.walletsCollection.insertMany(walletsArray);
      }

      console.log(`Saved ${walletsArray.length} monitored wallets to database`);
    } catch (error) {
      console.error('Error saving monitored wallets:', error.message);
    }
  }

  /**
   * Load monitored wallets from database
   * @returns {Array} Array of wallet data objects
   */
  async loadMonitoredWallets() {
    if (!this.isConnected) {
      console.warn('Cannot load monitored wallets: Not connected to MongoDB');
      return [];
    }

    try {
      const wallets = await this.walletsCollection.find({}).toArray();
      console.log(`Loaded ${wallets.length} monitored wallets from database`);
      return wallets;
    } catch (error) {
      console.error('Error loading monitored wallets:', error.message);
      return [];
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

module.exports = Mongo;

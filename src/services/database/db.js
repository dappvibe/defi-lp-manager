const mongoose = require('mongoose');
const Pool = require('./models/Pool');
const Position = require('./models/Position');
const PoolMessage = require('./models/PoolMessage');
const Wallet = require('./models/Wallet');
const Token = require('./models/Token');

class Db {
  constructor(config) {
    this.uri = config.db.uri;
    this.isConnected = false;
  }

  /**
   * Connect to MongoDB using Mongoose
   */
  async connect() {
    if (this.isConnected) return;

    try {
      await mongoose.connect(this.uri);
      console.log('Connected to MongoDB');
    } catch (error) {
      console.error('Failed to connect to MongoDB:', error.message);
      this.isConnected = false;
    }
  }

  /**
   * Disconnect from MongoDB
   */
  async disconnect() {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
      this.isConnected = false;
      console.log('Disconnected from MongoDB');
    }
  }

  // Pool methods

  /**
   * Helper method to populate token data for pools
   * @param {Array|Object} pools - Pool or array of pools to populate
   * @returns {Array|Object} Pools with populated token data
   */
  async populatePoolTokens(pools) {
    if (!pools) return pools;

    const isArray = Array.isArray(pools);
    const poolArray = isArray ? pools : [pools];

    // Get all unique token addresses
    const tokenAddresses = new Set();
    poolArray.forEach(pool => {
      if (pool.token0) tokenAddresses.add(pool.token0);
      if (pool.token1) tokenAddresses.add(pool.token1);
    });

    // Fetch all tokens at once
    const tokens = await Token.find({
      address: { $in: Array.from(tokenAddresses) }
    }).lean();

    // Create a map for quick lookup
    const tokenMap = new Map();
    tokens.forEach(token => {
      tokenMap.set(token.address, token);
    });

    // Populate pools with token data
    const populatedPools = poolArray.map(pool => {
      const populatedPool = { ...pool };
      if (pool.token0) {
        populatedPool.token0 = tokenMap.get(pool.token0) || { address: pool.token0, symbol: 'UNKNOWN', decimals: 18, name: 'Unknown Token' };
      }
      if (pool.token1) {
        populatedPool.token1 = tokenMap.get(pool.token1) || { address: pool.token1, symbol: 'UNKNOWN', decimals: 18, name: 'Unknown Token' };
      }
      return populatedPool;
    });

    return isArray ? populatedPools : populatedPools[0];
  }

  async savePoolState(poolAddress, poolData) {
    try {
      const updateData = {
        address: poolAddress,
        ...poolData,
        updatedAt: new Date()
      };

      await Pool.findOneAndUpdate(
        { address: poolAddress },
        updateData,
        { upsert: true, new: true }
      );
    } catch (error) {
      console.error(`Error saving pool data for ${poolAddress}:`, error.message);
    }
  }

  async loadAllPools() {
    try {
      const pools = await Pool.find({}).lean();
      const populatedPools = await this.populatePoolTokens(pools);
      const result = {};

      populatedPools.forEach(pool => {
        const { address, ...poolData } = pool;
        result[address] = poolData;
      });

      console.log(`Loaded ${pools.length} pools from database`);
      return result;
    } catch (error) {
      console.error('Error loading pools:', error.message);
      return {};
    }
  }

  async removePool(poolAddress) {
    try {
      await Pool.deleteOne({ address: poolAddress });
      console.log(`Removed pool ${poolAddress} from database`);
    } catch (error) {
      console.error(`Error removing pool ${poolAddress}:`, error.message);
    }
  }

  async cachePoolInfo(poolAddress, poolInfo) {
    await this.savePoolState(poolAddress, poolInfo);
  }

  async getCachedPoolInfo(poolAddress) {
    try {
      const poolInfo = await Pool.findOne({ address: poolAddress }).lean();
      if (poolInfo) {
        return await this.populatePoolTokens(poolInfo);
      }
      return null;
    } catch (error) {
      console.error(`Error retrieving pool info for ${poolAddress}:`, error.message);
      return null;
    }
  }

  async getAllCachedPools() {
    try {
      const pools = await Pool.find({}).lean();
      const populatedPools = await this.populatePoolTokens(pools);
      console.log(`Retrieved ${pools.length} pools`);
      return populatedPools;
    } catch (error) {
      console.error('Error retrieving all pools:', error.message);
      return [];
    }
  }

  async findPoolsByTokenAddress(tokenAddress) {
    try {
      const normalizedAddress = tokenAddress.toLowerCase();

      // Find pools that contain this token address
      const pools = await Pool.find({
        $or: [
          { token0: normalizedAddress },
          { token1: normalizedAddress }
        ]
      }).lean();

      const populatedPools = await this.populatePoolTokens(pools);
      console.log(`Found ${pools.length} pools containing token ${tokenAddress}`);
      return populatedPools;
    } catch (error) {
      console.error(`Error finding pools by token ${tokenAddress}:`, error.message);
      return [];
    }
  }

  async findPoolsByTokenSymbol(tokenSymbol) {
    try {
      // First find tokens by symbol
      const tokens = await Token.find({
        symbol: { $regex: new RegExp(tokenSymbol, 'i') }
      });

      if (tokens.length === 0) {
        console.log(`No tokens found with symbol matching ${tokenSymbol}`);
        return [];
      }

      const tokenAddresses = tokens.map(token => token.address);

      // Then find pools that reference these token addresses
      const pools = await Pool.find({
        $or: [
          { token0: { $in: tokenAddresses } },
          { token1: { $in: tokenAddresses } }
        ]
      }).lean();

      return await this.populatePoolTokens(pools);
    } catch (error) {
      console.error(`Error finding pools by token symbol ${tokenSymbol}:`, error.message);
      return [];
    }
  }

  async findPoolsByPlatformAndBlockchain(platform, blockchain) {
    try {
      const query = {
        platform: platform.toLowerCase(),
        blockchain: blockchain.toLowerCase()
      };

      const pools = await Pool.find(query).lean();
      const populatedPools = await this.populatePoolTokens(pools);
      console.log(`Found ${pools.length} pools on ${platform} ${blockchain}`);
      return populatedPools;
    } catch (error) {
      console.error(`Error finding pools by platform and blockchain:`, error.message);
      return [];
    }
  }

  /**
   * Find pool by token addresses and fee
   * @param {string} token0Address - Address of token0
   * @param {string} token1Address - Address of token1
   * @param {number} fee - Pool fee value
   * @returns {Promise<Object|null>} Pool object with populated token data or null if not found
   */
  async findPoolByTokensAndFee(token0Address, token1Address, fee) {
    try {
      const normalizedToken0 = token0Address.toLowerCase();
      const normalizedToken1 = token1Address.toLowerCase();

      // Find pool that matches the tokens (in either order) and fee
      const pool = await Pool.findOne({
        $and: [
          {
            $or: [
              { token0: normalizedToken0, token1: normalizedToken1 },
              { token0: normalizedToken1, token1: normalizedToken0 }
            ]
          },
          { fee: fee }
        ]
      }).lean();

      if (pool) {
        return await this.populatePoolTokens(pool);
      }
      return null;
    } catch (error) {
      console.error(`Error finding pool by tokens ${token0Address}, ${token1Address} and fee ${fee}:`, error.message);
      return null;
    }
  }

  // Pool Message methods
  async savePoolMessage(poolAddress, chatId, messageId, isMonitored = true) {
    try {
      const compositeId = `${poolAddress}_${chatId}`;
      const poolMessage = {
        _id: compositeId,
        poolAddress,
        chatId,
        messageId,
        isMonitored,
        updatedAt: new Date()
      };

      await PoolMessage.findByIdAndUpdate(
        compositeId,
        poolMessage,
        { upsert: true, new: true }
      );
    } catch (error) {
      console.error(`Error saving pool message for ${poolAddress}:`, error.message);
    }
  }

  async getPoolMessage(poolAddress, chatId) {
    try {
      const compositeId = `${poolAddress}_${chatId}`;
      return await PoolMessage.findById(compositeId).lean();
    } catch (error) {
      console.error(`Error getting pool message for ${poolAddress}:`, error.message);
      return null;
    }
  }

  async getMonitoredPoolMessages() {
    try {
      return await PoolMessage.find({
        isMonitored: true
      }).lean();
    } catch (error) {
      console.error('Error getting monitored pool messages:', error.message);
      return [];
    }
  }

  async removePoolMessage(poolAddress, chatId) {
    try {
      const compositeId = `${poolAddress}_${chatId}`;
      await PoolMessage.findByIdAndDelete(compositeId);

      console.log(`Removed pool message for ${poolAddress} in chat ${chatId}`);
    } catch (error) {
      console.error(`Error removing pool message for ${poolAddress}:`, error.message);
    }
  }

  async updatePoolMessageId(poolAddress, chatId, messageId) {
    try {
      const compositeId = `${poolAddress}_${chatId}`;
      await PoolMessage.findByIdAndUpdate(
        compositeId,
        {
          messageId,
          updatedAt: new Date()
        }
      );

      console.log(`Updated message ID for pool message ${poolAddress} in chat ${chatId}`);
    } catch (error) {
      console.error(`Error updating pool message ID for ${poolAddress}:`, error.message);
    }
  }

  // Position methods
  async savePosition(position) {
    try {
      const { tokenId, walletAddress, ...positionData } = position;
      const positionDoc = {
        tokenId,
        walletAddress,
        ...positionData,
        updatedAt: new Date()
      };

      await Position.findOneAndUpdate(
        { tokenId, walletAddress },
        positionDoc,
        { upsert: true, new: true }
      );
    } catch (error) {
      console.error(`Error saving position ${position.tokenId}:`, error.message);
    }
  }

  async getPosition(tokenId, walletAddress) {
    try {
      return await Position.findOne({
        tokenId,
        walletAddress
      }).lean();
    } catch (error) {
      console.error(`Error getting position ${tokenId}:`, error.message);
      return null;
    }
  }

  async getPositionsByWallet(walletAddress) {
    try {
      return await Position.find({
        walletAddress
      }).lean();
    } catch (error) {
      console.error(`Error getting positions for wallet ${walletAddress}:`, error.message);
      return [];
    }
  }

  async removePosition(tokenId, walletAddress) {
    try {
      await Position.deleteOne({
        tokenId,
        walletAddress
      });
    } catch (error) {
      console.error(`Error removing position ${tokenId}:`, error.message);
    }
  }

  // Token methods
  async getCachedToken(address, chainId) {
    try {
      const tokenData = await Token.findById(address.toLowerCase()).lean();

      if (tokenData) {
        return tokenData;
      }
      return null;
    } catch (error) {
      console.error(`Error getting cached token for ${address}:`, error);
      return null;
    }
  }

  async cacheToken(address, chainId, tokenData) {
    try {
      const normalizedAddress = address.toLowerCase();
      const tokenDoc = {
        _id: normalizedAddress,
        address: normalizedAddress,
        chainId,
        ...tokenData,
        cachedAt: new Date()
      };

      await Token.findByIdAndUpdate(
        normalizedAddress,
        tokenDoc,
        { upsert: true, new: true }
      );
    } catch (error) {
      console.error(`Error caching token for ${address}:`, error);
    }
  }

  async getAllCachedTokens() {
    try {
      return await Token.find({}).lean();
    } catch (error) {
      console.error('Error getting all cached tokens:', error);
      return [];
    }
  }

  async clearTokenCache() {
    try {
      await Token.deleteMany({});
      console.log('Cleared token cache');
    } catch (error) {
      console.error('Error clearing token cache:', error);
    }
  }

  async removeTokenFromCache(address, chainId) {
    try {
      await Token.findByIdAndDelete(address.toLowerCase());
    } catch (error) {
      console.error(`Error removing token ${address} from cache:`, error);
    }
  }

  // Wallet methods
  async getAllMonitoredWallets() {
    try {
      return await Wallet.find({}).lean();
    } catch (error) {
      console.error('Error getting monitored wallets:', error);
      return [];
    }
  }

  async saveMonitoredWallet(address, chatId) {
    try {
      await Wallet.findOneAndUpdate(
        { address, chatId },
        {
          address,
          chatId,
          lastUpdated: new Date()
        },
        { upsert: true, new: true }
      );
    } catch (error) {
      console.error('Error saving monitored wallet:', error);
      throw error;
    }
  }

  async removeMonitoredWallet(address, chatId) {
    try {
      await Wallet.deleteOne({
        address,
        chatId
      });
    } catch (error) {
      console.error('Error removing monitored wallet:', error);
      throw error;
    }
  }

  // Legacy compatibility methods
  get walletsCollection() {
    return {
      find: (query) => ({
        toArray: () => Wallet.find(query).lean()
      }),
      updateOne: (filter, update, options) =>
        Wallet.findOneAndUpdate(filter, update.$set, { upsert: options?.upsert }),
      deleteOne: (filter) => Wallet.deleteOne(filter)
    };
  }

  get db() {
    return {
      collection: (name) => {
        switch (name) {
          case 'tokens':
            return {
              findOne: (query) => Token.findOne(query).lean(),
              replaceOne: (filter, doc, options) =>
                Token.findOneAndUpdate(filter, doc, { upsert: options?.upsert, new: true }),
              deleteMany: (query) => Token.deleteMany(query),
              deleteOne: (query) => Token.deleteOne(query),
              find: (query) => ({
                toArray: () => Token.find(query).lean()
              }),
              createIndex: () => Promise.resolve() // Indexes are handled in schema
            };
          default:
            throw new Error(`Collection ${name} not supported in legacy compatibility mode`);
        }
      }
    };
  }
}

module.exports = Db;

const { Token } = require('./TokenModel');
const {Schema} = require("mongoose");

const poolSchema = new Schema({
  address: { type: String, required: true, unique: true, index: true },
  token0: { type: String, required: true, index: true },
  token1: { type: String, required: true, index: true },
  fee: { type: Number, required: true },
  tickSpacing: Number,
  unlocked: Boolean,
  platform: { type: String, index: true },
  blockchain: { type: String, index: true },
  configName: String,
  configDescription: String,
  lastPriceT1T0: String,
  priceMonitoringEnabled: { type: Boolean, default: false },
  cachedAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

// Compound indexes
poolSchema.index({ token0: 1, token1: 1 });
poolSchema.index({ platform: 1, blockchain: 1 });

class PoolModel {
  /**
   * Helper method to populate token data for pools
   * @param {Array|Object} pools - PoolModel or array of pools to populate
   * @returns {Array|Object} Pools with populated token data
   */
  static async populateTokens(pools) {
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

  static async save(poolAddress, poolData) {
    try {
      const updateData = {
        address: poolAddress,
        ...poolData,
        updatedAt: new Date()
      };

      await PoolModel.findOneAndUpdate(
        { address: poolAddress },
        updateData,
        { upsert: true, new: true }
      );
    } catch (error) {
      console.error(`Error saving pool data for ${poolAddress}:`, error.message);
    }
  }

  static async loadAll() {
    try {
      const pools = await PoolModel.find({}).lean();
      const populatedPools = await this.populateTokens(pools);
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

  static async remove(poolAddress) {
    try {
      await PoolModel.deleteOne({ address: poolAddress });
      console.log(`Removed pool ${poolAddress} from database`);
    } catch (error) {
      console.error(`Error removing pool ${poolAddress}:`, error.message);
    }
  }

  static async get(poolAddress) {
    try {
      const poolInfo = await this.findOne({ address: poolAddress }).lean();
      if (poolInfo) {
        return await this.populateTokens(poolInfo);
      }
      return null;
    } catch (error) {
      console.error(`Error retrieving pool info for ${poolAddress}:`, error.message);
      return null;
    }
  }

  static async all() {
    try {
      const pools = await PoolModel.find({}).lean();
      const populatedPools = await this.populateTokens(pools);
      console.log(`Retrieved ${pools.length} pools`);
      return populatedPools;
    } catch (error) {
      console.error('Error retrieving all pools:', error.message);
      return [];
    }
  }

  static async findByTokenAddress(tokenAddress) {
    try {
      const normalizedAddress = tokenAddress.toLowerCase();

      const pools = await PoolModel.find({
        $or: [
          { token0: normalizedAddress },
          { token1: normalizedAddress }
        ]
      }).lean();

      const populatedPools = await this.populateTokens(pools);
      console.log(`Found ${pools.length} pools containing token ${tokenAddress}`);
      return populatedPools;
    } catch (error) {
      console.error(`Error finding pools by token ${tokenAddress}:`, error.message);
      return [];
    }
  }

  static async findByTokenSymbol(tokenSymbol) {
    try {
      const tokens = await Token.find({
        symbol: { $regex: new RegExp(tokenSymbol, 'i') }
      });

      if (tokens.length === 0) {
        console.log(`No tokens found with symbol matching ${tokenSymbol}`);
        return [];
      }

      const tokenAddresses = tokens.map(token => token.address);

      const pools = await PoolModel.find({
        $or: [
          { token0: { $in: tokenAddresses } },
          { token1: { $in: tokenAddresses } }
        ]
      }).lean();

      return await this.populateTokens(pools);
    } catch (error) {
      console.error(`Error finding pools by token symbol ${tokenSymbol}:`, error.message);
      return [];
    }
  }

  static async findByPlatformAndBlockchain(platform, blockchain) {
    try {
      const query = {
        platform: platform.toLowerCase(),
        blockchain: blockchain.toLowerCase()
      };

      const pools = await PoolModel.find(query).lean();
      const populatedPools = await this.populateTokens(pools);
      console.log(`Found ${pools.length} pools on ${platform} ${blockchain}`);
      return populatedPools;
    } catch (error) {
      console.error(`Error finding pools by platform and blockchain:`, error.message);
      return [];
    }
  }

  static async findByTokensAndFee(token0Address, token1Address, fee) {
    try {
      const normalizedToken0 = token0Address.toLowerCase();
      const normalizedToken1 = token1Address.toLowerCase();

      const pool = await PoolModel.findOne({
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
        return await this.populateTokens(pool);
      }
      return null;
    } catch (error) {
      console.error(`Error finding pool by tokens ${token0Address}, ${token1Address} and fee ${fee}:`, error.message);
      return null;
    }
  }
}

poolSchema.loadClass(PoolModel);
module.exports = (mongoose) => mongoose.model('Pool', poolSchema);

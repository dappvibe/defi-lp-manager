const {Schema} = require("mongoose");
const {Position: UniswapPosition} = require("@uniswap/v3-sdk");

const positionSchema = new Schema({
  _id: String, // compose key for referencing
  chainId: { type: Number, required: true },
  owner: { type: String, required: true },
  positionManager: { type: String, required: true }, // issuer/platform
  tokenId: { type: Number, required: true },
  pool: { type: String, ref: 'Pool', required: true, autopopulate: true },
  tickLower: { type: Number, required: true },
  tickUpper: { type: Number, required: true },
  liquidity: { type: BigInt, required: true },
  isStaked: { type: Boolean, required: true },
  createdAt: { type: Date, default: Date.now, index: true },
  updatedAt: { type: Date, default: Date.now }
}, { _id: false });
positionSchema.plugin(require('mongoose-autopopulate'));

/**
 * @property {String} _id - Composite key in format chainId:address:tokenId
 * @property {Number} chainId - Chain identifier
 * @property {String} owner - Position owner address
 * @property {String} positionManager - Address of position manager contract
 * @property {Number} tokenId - NFT token identifier
 * @property {Pool} pool - Reference to associated pool
 * @property {Number} tickLower - Lower tick boundary
 * @property {Number} tickUpper - Upper tick boundary
 * @property {BigInt} liquidity - Amount of liquidity
 * @property {Boolean} isStaked - Whether position is staked
 * @property {Date} createdAt - Creation timestamp
 * @property {Date} updatedAt - Last update timestamp
 */
class PositionModel {
  static poolModel;
  static tokenModel;
  static chainId;
  static positionManager;
  static staker;

  get id() {
    return `${PositionModel.chainId}:${PositionModel.positionManager.address}:${this.tokenId}`;
  }

  /**
   * Find doc in the db and if not exists get details from blockchain, save and return doc.
   *
   * @param {Number} tokenId
   * @return {Promise<PositionModel>}
   */
  static async fetch(tokenId) {
    const filter = {
      chainId: PositionModel.chainId,
      positionManager: PositionModel.positionManager.address,
      tokenId
    };

    let doc = await this.findOne(filter);
    if (!doc) {
      doc = await this.fromBlockchain(tokenId);
      try {
        await doc.save();
      } catch (e) {
        if (e.code === 11000) { // duplicate (race condition)
          doc = await this.findOne(filter);
          if (!doc) throw new Error(`Postion (${doc._id}) was concurrently created but not found after retry.`);
        }
        else throw e;
      }
    }

    return doc;
  }

  /**
  * Fetch position data from blockchain and return unsaved doc.
  * Use static chainId in this class, retreived from container.
  *
  * @param {Number|BigInt} tokenId
  * @return {Promise<PositionModel>}
  */
  static async fromBlockchain(tokenId) {
    let [data, owner] = await Promise.all([
      PositionModel.positionManager.read.positions([tokenId]),
      this.getOwner(tokenId)
    ]);
    data = {
      token0: data[2],
      token1: data[3],
      fee: data[4],
      tickLower: data[5],
      tickUpper: data[6],
      liquidity: data[7]
    };

    // Ensure dependant tokens exists in the db
    const pool = await PositionModel.poolModel.fetch(data.token0, data.token1, data.fee);

    const doc = new this;
    doc.tokenId = tokenId;
    Object.assign(doc, {
      _id: doc.id,
      chainId: PositionModel.chainId,
      owner: owner,
      positionManager: PositionModel.positionManager.address,
      pool: pool,
      tickLower: data.tickLower,
      tickUpper: data.tickUpper,
      liquidity: data.liquidity,
      isStaked: await PositionModel.isStaked(tokenId)
    })

    return doc;
  }

  static async isStaked(tokenId) {
    const res = await PositionModel.staker.read.userPositionInfos([tokenId]);
    return res[6] !== '0x0000000000000000000000000000000000000000'; // user (owner)
  }

  static async getOwner(tokenId) {
    return PositionModel.positionManager.read.ownerOf([tokenId]);
  }

  async isInRange() {
    const prices = await this.pool.getPrices(this);
    return prices.current >= prices.lower && prices.current <= prices.upper;
  }

  isEmpty() {
    // FIXME approx. value calculation with available data. best guess (maybe token names?)
    return this.liquidity === 0n;
  }

  async calculateTokenAmounts() {
    const sdk = await this.toUniswapSDK();
    return [
      Number(sdk.amount0.toFixed(this.pool.token0.decimals)),
      Number(sdk.amount1.toFixed(this.pool.token1.decimals)),
    ];
  }

  /**
   * Calculate combined token1 value for a position. Assumes token1 is a stablecoin.
   * @returns {Promise<number>} Combined value in token1 units
   */
  async calculateCombinedValue() {
    const amounts = await this.calculateTokenAmounts();
    const price = await this.pool.getPrices();
    return amounts[1] + amounts[0] * price.current;
  }

  /**
   * Fetch accumulated fees for a position
   * @returns {Promise<Object>} Accumulated fees
   */
  async calculateUnclaimedFees() {
    if (this.liquidity === 0n) return {
      token0Fees: 0,
      token1Fees: 0,
      //totalValue: 0
    };

    // Prepare collect call with max values to simulate fee collection without actually collecting
    const collectParams = {
      tokenId: this.tokenId,
      recipient: '0x0000000000000000000000000000000000000000', // Zero address for simulation
      amount0Max: BigInt('340282366920938463463374607431768211455'), // Max uint128
      amount1Max: BigInt('340282366920938463463374607431768211455')  // Max uint128
    };
    const feeAmounts = await PositionModel.positionManager.simulate.collect([collectParams]);
    const token0Fees = this.pool.token0.getFloatAmount(feeAmounts.result[0]);
    const token1Fees = this.pool.token1.getFloatAmount(feeAmounts.result[1]);

    // Calculate total value assuming token1 is stablecoin (like USDC)
    const price = await this.pool.getPrices(this);
    let totalValue = (+token0Fees * price.current + +token1Fees).toFixed(this.pool.token1.decimals);

    // Add CAKE rewards if position is staked
    let cakeRewards = null;
    const cakeRewardAmount = await this.calculateCakeRewards();
    if (cakeRewardAmount > 0) {
      const cakePrice = await this.getCakePrice();
      const cakeValue = cakeRewardAmount * cakePrice;
      cakeRewards = {
        amount: cakeRewardAmount.toFixed(4),
        value: cakeValue,
        price: cakePrice
      };
    }

    return {
      token0Fees: token0Fees,
      token1Fees: token1Fees,
      totalValue,
      currentPrice: price.current,
      cakeRewards
    };
  }

  /**
   * Fetch CAKE rewards for a staked position
   * @returns {Promise<number>} CAKE reward amount
   */
  async calculateCakeRewards() {
    if (!this.isStaked) return 0; // No rewards for unstaked positions

    const pendingCake = await PositionModel.staker.read.pendingCake([this.tokenId]);

    if (!pendingCake || pendingCake === 0n) return 0;

    // Convert to human readable amount (CAKE has 18 decimals)
    return parseFloat(pendingCake.toString()) / Math.pow(10, 18);
  }


  /**
   * Get current CAKE price in USD from CAKE/USDT pool
   * @returns {Promise<number>} CAKE price in USD
   *
   * FIXME fetch actual price with good multi-chain design
   */
  async getCakePrice() {
    return 1;

    try {
      const { Pool } = require('./pool');

      // Find CAKE pools
      const cakePools = await this._db.findPoolsByTokenSymbol('Cake');

      if (cakePools.length === 0) {
        throw new Error('No CAKE pools found in database');
      }

      // Find a CAKE/USDT or CAKE/USDC pool
      const cakeStablePool = cakePools.find(pool => {
        const token0Symbol = pool.token0.symbol;
        const token1Symbol = pool.token1.symbol;
        return (token0Symbol === 'Cake' && (token1Symbol === 'USDT' || token1Symbol === 'USDC')) ||
          ((token0Symbol === 'USDT' || token0Symbol === 'USDC') && token1Symbol === 'Cake');
      });

      if (!cakeStablePool) {
        throw new Error('No CAKE/USDT or CAKE/USDC pool found');
      }

      // Get the pool instance
      const pool = Pool.getPool(cakeStablePool.address);

      // Get current price from the pool
      return await pool.getPrice();
    } catch (error) {
      console.error('(Try /pool) Error fetching CAKE price from pool:', error);
      return 0; // Fallback price
    }
  }

  async toUniswapSDK() {
    const pool = await this.pool.toUniswapSDK();
    return new UniswapPosition({
      pool,
      liquidity: this.liquidity.toString(),
      tickLower: this.tickLower,
      tickUpper: this.tickUpper
    });
  }
}

positionSchema.loadClass(PositionModel);

module.exports = function(mongoose, chainId, positionManager, staker, PoolModel, TokenModel) {
  const injectDeps = (doc) => Object.assign(doc, { positionManager, staker });
  positionSchema.post('save', injectDeps)
  positionSchema.post('init', injectDeps)

  PositionModel.poolModel = PoolModel;
  PositionModel.tokenModel = TokenModel;
  PositionModel.chainId = chainId;
  PositionModel.positionManager = positionManager;
  PositionModel.staker = staker;

  return mongoose.model('Position', positionSchema);
}

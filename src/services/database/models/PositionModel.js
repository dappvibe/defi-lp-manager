const {Schema} = require("mongoose");
const {EventEmitter} = require('events');
const {Position: UniswapPosition} = require("@uniswap/v3-sdk");

const positionSchema = new Schema({
  _id: String, // compose key for referencing
  chainId: { type: Number, required: true },
  tokenId: { type: Number, required: true },
  messageId: { type: Number, index: true, default: null },
  pool: { type: String, ref: 'Pool', required: true },
  tickLower: { type: Number, required: true },
  tickUpper: { type: Number, required: true },
  liquidity: { type: BigInt, required: true },
  isStaked: { type: Boolean, required: true },
  createdAt: { type: Date, default: Date.now, index: true },
  updatedAt: { type: Date, default: Date.now }
}, { _id: false });

positionSchema.virtual('owner').get(function() { return this._id.split(':')[1]; });
positionSchema.virtual('tokenIndex').get(function() { return +this._id.split(':')[2]; });

/**
 * @property _id
 * @property owner
 * @property tokenIndex
 * @property chainId
 * @property tokenId
 * @property messageId
 * @property pool
 * @property tickLower
 * @property tickUpper
 * @property liquidity
 * @property isStaked
 * @property createdAt
 * @property updatedAt
 */
class PositionModel {
  // Contracts singletons are automatically attached to each instance (see exports)
  static poolModel;
  static chainId;
  static positionManager;
  static staker;

  static id(chainId, owner, tokenIndex) { return `${chainId}:${owner.toLowerCase()}:${tokenIndex}`; }

  static async findOrCreate(chainId, tokenId, tokenIndex) {
    if (!Number.isFinite(chainId) || !Number.isFinite(tokenId) || !Number.isFinite(tokenIndex)) {
      throw new Error('chainId, tokenId and tokenIndex must be numbers');
    }

    let doc = await this.findOne({ chainId, tokenId });
    if (!doc) {
      doc = new this();
      doc.chainId = chainId;
      doc.tokenId = tokenId;
      Object.assign(doc, await this.readBlockchain(tokenId));
      doc.isStaked = await this.isStaked(tokenId);
      const owner = await this.getOwner(tokenId);
      doc._id = PositionModel.id(doc.chainId, owner, tokenIndex);

      // make sure referenced objects exists
      doc.pool = await PositionModel.poolModel.findOrCreate(doc.chainId, doc.token0, doc.token1, doc.fee);

      await doc.save();
    }
    await doc.populate('pool');
    return doc;
  }

  static async readBlockchain(tokenId) {
    const data = await PositionModel.positionManager.read.positions([tokenId]);
    return {
      token0: data[2],
      token1: data[3],
      fee: data[4],
      tickLower: data[5],
      tickUpper: data[6],
      liquidity: data[7]
    };
  }

  static async isStaked(tokenId) {
    const res = await PositionModel.staker.read.userPositionInfos([tokenId]);
    return res[6] !== '0x0000000000000000000000000000000000000000'; // user (owner)
  }

  static async getOwner(tokenId) {
    return await PositionModel.positionManager.read.ownerOf([tokenId]);
  }

  async isInRange() {
    await this.populate('pool');
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

    // Convert token0 amount to token1 equivalent using current price
    const token0AmountInToken1 = amounts[0] * price.current;

    return amounts[1] + token0AmountInToken1;
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

    await this.populate('pool');
    await this.pool.populate('token0 token1');

    // Prepare collect call with max values to simulate fee collection without actually collecting
    const collectParams = {
      tokenId: this.tokenId,
      recipient: '0x0000000000000000000000000000000000000000', // Zero address for simulation
      amount0Max: BigInt('340282366920938463463374607431768211455'), // Max uint128
      amount1Max: BigInt('340282366920938463463374607431768211455')  // Max uint128
    };
    const feeAmounts = await PositionModel.positionManager.simulate.collect([collectParams]);
    const amount0Fees = feeAmounts.result[0];
    const amount1Fees = feeAmounts.result[1];

    // Convert to human readable amounts
    const token0FeesFormatted = (parseFloat(amount0Fees.toString()) / Math.pow(10, this.pool.token0.decimals)).toFixed(this.pool.token0.decimals);
    const token1FeesFormatted = (parseFloat(amount1Fees.toString()) / Math.pow(10, this.pool.token1.decimals)).toFixed(this.pool.token1.decimals);

    // Calculate total value assuming token1 is stablecoin (like USDC)
    const price = await this.pool.getPrices(this);
    const token0Value = parseFloat(token0FeesFormatted) * (price.current);
    const token1Value = parseFloat(token1FeesFormatted);
    let totalValue = token0Value + token1Value;

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
      token0Fees: token0FeesFormatted,
      token1Fees: token1FeesFormatted,
      token0Symbol: this.pool.token0.symbol,
      token1Symbol: this.pool.token1.symbol,
      token0Value,
      token1Value,
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
    await this.populate('pool');
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

module.exports = function(mongoose, chainId, positionManager, staker, poolModel) {
  const injectDeps = (doc) => Object.assign(doc, { positionManager, staker });
  positionSchema.post('save', injectDeps)
  positionSchema.post('init', injectDeps)

  PositionModel.poolModel = poolModel;
  PositionModel.chainId = chainId;
  PositionModel.positionManager = positionManager;
  PositionModel.staker = staker;

  return mongoose.model('Position', positionSchema);
}

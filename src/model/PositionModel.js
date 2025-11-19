const {Schema} = require("mongoose");
const {Position: UniswapPosition} = require("@uniswap/v3-sdk");

const positionSchema = new Schema({
  _id: String, // chainId:nftManagerAddress:tokenId (manager distinguish DEXes)
  chainId: { type: Number, required: true },
  owner: { type: String, required: true },
  positionManager: { type: String, required: true }, // issuer/platform
  tokenId: { type: Number, required: true },
  pool: { type: String, ref: 'Pool', required: true, autopopulate: true },
  tickLower: { type: Number, required: true },
  tickUpper: { type: Number, required: true },
  liquidity: { type: BigInt, required: true },
  isStaked: { type: Boolean, required: true },
}, { _id: false, timestamps: true });
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
  static cache;

  get id() {
    return `${this.chainId}:${this.positionManager}:${this.tokenId}`;
  }

  /**
   * Find doc in the db and if not exists get details from blockchain, save and return doc.
   *
   * @param {Number} tokenId
   * @return {Promise<PositionModel>}
   */
  static async fetch(tokenId) {
    const id = `${PositionModel.chainId}:${PositionModel.positionManager.address}:${tokenId}`;

    let doc = await this.findById(id);
    if (!doc) {
      doc = await this.fromBlockchain(tokenId);
      try {
        await doc.save();
      } catch (e) {
        if (e.code === 11000) { // duplicate (race condition)
          doc = await this.findById(id);
          if (!doc) throw new Error(`Position (${doc._id}) was concurrently created but not found after retry.`);
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
      liquidity: data[7],
      // NOTE: createdAt on blockchain can be queried only with unlimited logs which is not available in free-tier alchemy.
      // Thus rely on watching wallet events and save doc approx. the same time when position appears in logs.
    };

    // Ensure dependant tokens exists in the db
    const pool = await PositionModel.poolModel.fetch(data.token0, data.token1, data.fee);

    return new this({ // getter id() will return null even if set doc props before _id, thus copy code
      _id: `${PositionModel.chainId}:${PositionModel.positionManager.address}:${tokenId}`,
      chainId: PositionModel.chainId,
      positionManager: PositionModel.positionManager.address,
      tokenId,
      owner: owner,
      pool: pool,
      tickLower: data.tickLower,
      tickUpper: data.tickUpper,
      liquidity: data.liquidity,
      isStaked: await PositionModel.isStaked(tokenId)
    });
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

  async isEmpty() {
    // maybe? is empty if displayed decimals for both tokens are zeros. Not empty is at least 1 is shown in out precision
    if (this.liquidity === 0n) return true;

    const value = await this.calculateCombinedValue();
    return value < 0.01;
  }

  calculateTokenAmounts() {
    const sdk = this.toUniswapSDK();
    return [
      Number(sdk.amount0.toFixed(this.pool.token0.decimals)),
      Number(sdk.amount1.toFixed(this.pool.token1.decimals)),
    ];
  }

  /**
   * Calculate combined token1 value for a position. Assumes token1 is a stablecoin.
   * @returns {Number} Combined value in token1 units
   */
  calculateCombinedValue() {
    const amounts = this.calculateTokenAmounts();
    const price = this.pool.getPrices();
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
      totalValue: 0
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

    const rewards = {
      amount: await this.calculateCakeRewards(),
    };

    return {
      token0Fees: token0Fees,
      token1Fees: token1Fees,
      totalValue,
      currentPrice: price.current,
      rewards
    };
  }

  /**
   * Fetch CAKE rewards for a staked position
   * @returns {Promise<number>} CAKE reward amount
   */
  async calculateCakeRewards() {
    if (!this.isStaked) return 0; // No rewards for unstaked positions

    let pendingCake = PositionModel.cache.get('pendingCake-'+this._id);
    if (!pendingCake) {
      pendingCake = await PositionModel.staker.read.pendingCake([this.tokenId])
      PositionModel.cache.set('pendingCake-'+this._id, pendingCake, 60);
    }

    if (!pendingCake || pendingCake === 0n) return 0;

    // Convert to human readable amount (CAKE has 18 decimals)
    return parseFloat(pendingCake.toString()) / Math.pow(10, 18);
  }

  toUniswapSDK() {
    return new UniswapPosition({
      pool: this.pool.toUniswapSDK(),
      liquidity: this.liquidity.toString(),
      tickLower: this.tickLower,
      tickUpper: this.tickUpper
    });
  }

  startMonitoring() {
    this.pool.startMonitoring();
    this.pool.on('swap', (e) => {
      e.prices.lower = this.pool.tickToPrice(this.tickLower);
      e.prices.upper = this.pool.tickToPrice(this.tickUpper);
      this.emit('swap', e);
      this.emit('range', e.tick >= this.tickLower && e.tick <= this.tickUpper);
    });
  }
}

positionSchema.loadClass(PositionModel);

module.exports = function(mongoose, cache, chainId, positionManager, staker, PoolModel, TokenModel) {
  PositionModel.poolModel = PoolModel;
  PositionModel.tokenModel = TokenModel;
  PositionModel.chainId = chainId;
  PositionModel.positionManager = positionManager;
  PositionModel.staker = staker;
  PositionModel.cache = cache;

  return mongoose.model('Position', positionSchema);
}

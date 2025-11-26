const {Schema} = require("mongoose");
const {Position: UniswapPosition} = require("@uniswap/v3-sdk");
const autopopulate = require('mongoose-autopopulate');
const {isAddress} = require("viem");

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
class PositionModel
{
  static schema = new Schema({
    _id: { // chainId:nftManagerAddress:tokenId (manager distinguish DEXes)
      type: String,
      lowercase: true,
      validate: function(v) {
        const [chainId, address, tokenId] = v.split(':');
        if (!/^\d+$/.test(chainId)) throw new Error('chainId is not numeric: ' + v);
        if (!isAddress(address)) throw new Error('Invalid address: ' + v);
        if (!/^\d+$/.test(tokenId)) throw new Error('Invalid tokenId: ' + tokenId);
      }
    },
    owner: { type: String, required: true, lowercase: true, validate: isAddress },
    pool: { type: String, ref: 'Pool', required: true, autopopulate: true },
    tickLower: { type: Number, required: true },
    tickUpper: { type: Number, required: true },
    liquidity: { type: BigInt, required: true, min: 0 },
    isStaked: { type: Boolean, required: true },
  }, { _id: false, timestamps: true });

  static poolModel;
  static tokenModel;
  static chainId;
  static positionManager;
  static staker;
  static cache;
  static cakePool; // promise

  static {
    PositionModel.schema.pre('save', async function() {
      if (this.pool === null && this.populated('pool')) {
        this.depopulate('pool');
        let pool = await PositionModel.poolModel.findById(this.pool);
        if (!pool) {
          pool = await PositionModel.poolModel.fromBlockchain(this.pool);
          if (pool) await pool.save();
          else throw new Error(`Pool ${this.pool} not found in blockchain`);
        }
        await this.populate('pool');
      }
    });

    const events = ['findOne', 'findById', 'find', 'findOneAndUpdate', 'findOneAndReplace', 'findOneAndDelete'];
    PositionModel.schema.post(events, async function(doc)  {
      if (!doc) return;

      async function ensurePool(doc) {
        if (doc.pool === null) {
          doc.depopulate('pool');
          doc.pool = await PositionModel.poolModel.fromBlockchain(doc.pool);
          try {
            await doc.pool.save();
          } catch (e) {
            if (e.code !== 11000) throw e;
          }
        }
      }

      if (Array.isArray(doc)) {
        await Promise.all(doc.map(ensurePool));
      } else {
        await ensurePool(doc);
      }
    });
  }

  get chainId() { return Number(this._id.split(':')[0]); }
  get positionManagerAddress() { return this._id.split(':')[1]; }
  get tokenId() { return Number(this._id.split(':')[2]); }

  async isInRange() {
    const prices = await this.pool.getPrices(this);
    return prices.current >= prices.lower && prices.current <= prices.upper;
  }

  isEmpty() {
    if (this.liquidity === 0n) return true;
    return this.calculateCombinedValue() < 0.01;
  }

  calculateTokenAmounts() {
    const sdk = this.toUniswapSDK();
    return [
      sdk.amount0.toSignificant(),
      sdk.amount1.toSignificant(),
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
    const token0Fees = this.pool.token0.format(feeAmounts.result[0]);
    const token1Fees = this.pool.token1.format(feeAmounts.result[1]);

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

    const pool = await PositionModel.cakePool;
    return pool.token0.format(pendingCake);
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

  stopMonitoring() {
    // TODO delete registered event on this. do not touch pool monitoring
  }

  /**
   * Fetch position data from blockchain and return unsaved doc.
   * Use static chainId in this class, retreived from container.
   * @return {Promise<PositionModel>}
   */
  static async fromBlockchain(id) {
    let chainId, positionManager, tokenId;
    try { [chainId, positionManager, tokenId] = id.split(':'); }
    catch (e) { throw new Error('Invalid PositionModel: ' + id); }

    if (positionManager !== PositionModel.positionManager.address) {
      throw new Error('Position manager mismatch: ' + PositionModel.positionManager.address);
    }

    let [data, owner] = await Promise.all([
      PositionModel.positionManager.read.positions([tokenId]), // should create contract with given address
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

    const poolAddress = await PositionModel.poolModel.getPoolAddress(data.token0, data.token1, data.fee);
    const poolId = `${chainId}:${poolAddress}`;
    let pool = await this.poolModel.findById(poolId);
    if (!pool) {
      pool = await this.poolModel.fromBlockchain(poolId);
      await pool.save();
    }
    return new this({
      _id: id,
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
}

module.exports = function(mongoose, cache, chainId, cakePool, positionManager, staker, PoolModel, TokenModel) {
  PositionModel.poolModel = PoolModel;
  PositionModel.tokenModel = TokenModel;
  PositionModel.chainId = chainId;
  PositionModel.positionManager = positionManager;
  PositionModel.staker = staker;
  PositionModel.cache = cache;
  PositionModel.cakePool = cakePool;

  return mongoose.model('Position', PositionModel.schema.loadClass(PositionModel).plugin(autopopulate));
}

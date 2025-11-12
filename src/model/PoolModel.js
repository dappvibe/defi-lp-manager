const {Schema} = require("mongoose");
const {Pool: UniswapPool, tickToPrice} = require('@uniswap/v3-sdk');
const autopopulate = require('mongoose-autopopulate');
const {Price} = require("@uniswap/sdk-core");

const poolSchema = new Schema({
  _id: String, // chainId:address
  chainId: {type: Number, required: true}, // must be a field for search
  token0: {type: String, ref: 'Token', required: true, autopopulate: true},
  token1: {type: String, ref: 'Token', required: true, autopopulate: true},
  fee: {type: Number, required: true},
  priceMonitored: {type: Boolean, default: false},
  updatedAt: {type: Date, default: Date.now}
}, {_id: false});
poolSchema.plugin(autopopulate);

poolSchema.virtual('address').get(function() {
  return this._id.split(':')[1];
});

/**
 * @property {String} _id - Composite key in format chainId:address
 * @property {Number} chainId - Chain identifier
 * @property {TokenModel} token0 - Reference to first token in pool
 * @property {TokenModel} token1 - Reference to second token in pool
 * @property {Number} fee - Pool fee tier
 * @property {Boolean} priceMonitored - Indicates if pool price is being monitored
 * @property {Date} updatedAt - Last update timestamp
 * @property {String} address - Virtual property returning pool contract address
 * @property {Object} contract - Instance of pool contract
 */
class PoolModel {
  static chainId;
  static poolFactoryContract;
  static poolContract;
  static tokenModel;

  contract; // attached instance
  swapListener = null;

  static id(chainId, address) {
    return `${chainId}:${address.toLowerCase()}`;
  }

  /**
   * Find doc in the db and if not exists get details from blockchain, save and return doc.
   *
   * @param token0
   * @param token1
   * @param fee
   * @return {Promise<PoolModel>}
   */
  static async fetch(token0, token1, fee) {
    token0 = token0.toLowerCase();
    token1 = token1.toLowerCase();

    const filter = {
      chainId: PoolModel.chainId,
      token0: PoolModel.tokenModel.id(PoolModel.chainId, token0),
      token1: PoolModel.tokenModel.id(PoolModel.chainId, token1),
      fee
    };
    let doc = await this.findOne(filter);
    if (!doc) {
      doc = await this.fromBlockchain(token0, token1, fee);
      try {
        await doc.save();
      } catch (e) {
        if (e.code === 11000) { // duplicate (race condition)
          doc = await this.findOne(filter);
          if (!doc) throw new Error(`Pool with _id ${doc._id} was concurrently created but not found after retry.`);
        }
        else throw e;
      }
    }

    return doc;
  }

  /**
   * Fetch pool details from blockchain and return unsaved doc.
   * Use static chainId in this class, retreived from container.
   *
   * @param {String} token0
   * @param {String} token1
   * @param {Number} fee
   * @return {Promise<PoolModel>}
   */
  static async fromBlockchain(token0, token1, fee) {
    // first find pool contract address from PoolFactoryV3
    let address = await PoolModel.poolFactoryContract.read.getPool([token0, token1, fee]);
    if (!address || address === '0x0000000000000000000000000000000000000000') {
      throw new Error(`Pool not found onchain (${PoolModel.chainId}) for tokens ${token0}/${token1} with fee ${fee}`);
    }
    address = address.toLowerCase();

    // Ensure dependant tokens exists in the db
    token0 = await PoolModel.tokenModel.fetch(token0);
    token1 = await PoolModel.tokenModel.fetch(token1);

    const doc = new this;
    Object.assign(doc, {
      _id: PoolModel.id(PoolModel.chainId, address),
      chainId: PoolModel.chainId,
      address,
      token0: token0.id,
      token1: token1.id,
      fee
    });

    await doc.populate('token0 token1'); // the plugin won't trigger on unsaved doc

    return doc;
  }

  /**
   * Get pool price and price bounds for given position.
   * If position is not provided, returns current pool price.
   *
   * @param {PositionModel} [position]
   * @return {Promise<{current: string, lower: string, upper: string, tick: number, sqrtPriceX96: bigint}>}
   */
  async getPrices(position = null) {
    const slot0 = await this.slot0();
    const prices = {
      sqrtPriceX96: slot0.sqrtPriceX96,
      tick: slot0.tick,
      current: this.decodePrice(slot0.sqrtPriceX96)
    };

    if (position) {
      prices.lower = tickToPrice(this.token0.toUniswapSDK(), this.token1.toUniswapSDK(), position.tickLower).toSignificant();
      prices.upper = tickToPrice(this.token0.toUniswapSDK(), this.token1.toUniswapSDK(), position.tickUpper).toSignificant();
    }

    //noinspection JSValidateTypes
    return prices;
  }

  /**
  * Decode sqrtPriceX96 from slot0 and return price in significant digits.
  *
  * @param {bigint} sqrtPrice
  * @return {string}
  */
  decodePrice(sqrtPrice) {
    //noinspection JSCheckFunctionSignatures
    const price = new Price(
      this.token0.toUniswapSDK(),
      this.token1.toUniswapSDK(),
      (2n ** 192n).toString(),
      (sqrtPrice ** 2n).toString()
    );
    return price.toSignificant();
  }

  /**
  * Read pool slot0 data from blockchain.
  *
  * @return {Promise<{sqrtPriceX96: bigint, tick: number, observationIndex: bigint, observationCardinality: bigint, observationCardinalityNext: bigint, feeProtocol: number, unlocked: boolean}>}
  */
  async slot0() {
    const res = await this.contract.read.slot0();
    return {
      sqrtPriceX96: res[0],
      tick: res[1],
      observationIndex: res[2],
      observationCardinality: res[3],
      observationCardinalityNext: res[4],
      feeProtocol: res[5],
      unlocked: res[6]
    };
  }

  /**
  * Read pool liquidity from blockchain.
  *
  * @return {Promise<bigint>}
  */
  async liquidity() {
    return await this.contract.read.liquidity();
  }

  /**
   * Calculate TVL for this pool
   * @returns {Promise<string>} TVL value or null if calculation fails
   */
  async getTVL() {
    // Get token balances in the pool
    let [prices, token0Balance, token1Balance] = await Promise.all([
      this.getPrices(),
      this.token0.contract.read.balanceOf([this.address]),
      this.token1.contract.read.balanceOf([this.address])
    ]);

    token0Balance = this.token0.getFloatAmount(token0Balance);
    token1Balance = this.token1.getFloatAmount(token1Balance);
    return (+token0Balance * +prices.current + +token1Balance).toFixed(this.token1.decimals);
  }

  /**
   * Listen for prices and emit 'swap' events on this object for each trade.
   */
  startMonitoring() {
    if (this.swapListener) return;

    this.swapListener = this.contract.watchEvent.Swap(
      {}, // watch all swaps
      {
        onLogs: (logs) => {
          logs.forEach((log) => {
            const {args} = log;
            if (!args) return; // no idea why some perfectly legit Swap's come without parsed arguments, every other event does
            const {sqrtPriceX96, amount0, amount1, tick, liquidity, protocolFeesToken0, protocolFeesToken1} = args;

            const event = {
              tick,
              liquidity,
              price: this.decodePrice(sqrtPriceX96),
              amount0: this.token0.getFloatAmount(amount0),
              amount1: this.token1.getFloatAmount(amount1),
              protocolFeesToken0: this.token0.getFloatAmount(protocolFeesToken0),
              protocolFeesToken1: this.token1.getFloatAmount(protocolFeesToken1),
            };
            this.emit('swap', event);
          })
        },
        onError: (error) => {
          console.error(`Error monitoring pool ${this.address}:`, error.message);
          return this.stopMonitoring();
        }
      }
    );
    return this;
  }

  /**
   * Stop monitoring this pool
   */
  stopMonitoring() {
    if (this.swapListener) {
      this.swapListener();
      this.swapListener = null;
    }
    return this;
  }

  async toUniswapSDK() {
    const [slot0, liquidity] = await Promise.all([
      this.slot0(),
      this.liquidity()
    ]);
    return new UniswapPool(
      this.token0.toUniswapSDK(),
      this.token1.toUniswapSDK(),
      this.fee,
      slot0.sqrtPriceX96.toString(),
      liquidity.toString(),
      slot0.tick
    );
  }
}

poolSchema.loadClass(PoolModel);

module.exports = function(mongoose, chainId, poolFactoryContract, poolContract, TokenModel) {
  poolSchema.post('init', function(doc) {
    doc.contract = poolContract(doc.address);
  })
  poolSchema.post('save', function(doc, next) {
    doc.contract = poolContract(doc.address);
    next();
  })

  PoolModel.chainId = chainId;
  PoolModel.poolFactoryContract = poolFactoryContract;
  PoolModel.poolContract = poolContract;
  PoolModel.tokenModel = TokenModel;

  return mongoose.model('Pool', poolSchema);
}

const {Schema} = require("mongoose");
const {Pool: UniswapPool, tickToPrice} = require('@uniswap/v3-sdk');
const autopopulate = require('mongoose-autopopulate');
const {Price} = require("@uniswap/sdk-core");

/**
 * @property {String} _id - Composite key in format chainId:address
 * @property {Number} chainId - Chain identifier
 * @property {TokenModel} token0 - Reference to first token in pool
 * @property {TokenModel} token1 - Reference to second token in pool
 * @property {Number} fee - Pool fee tier
 * @property {Number} tick - Current pool tick
 * @property {String} sqrtPriceX96 - Square root of current price as Q64.96
 * @property {String} liquidity - Current pool liquidity
 * @property {Date} updatedAt - Last update timestamp
 * @property {Date} createdAt - Pool creation timestamp
 * @property {String} address - Virtual property returning pool contract address
 * @property {Object} contract - Instance of pool contract
 */
class PoolModel
{
  static schema = new Schema({
    _id: String, // chainId:address
    token0: {type: String, ref: 'Token', required: true, autopopulate: true},
    token1: {type: String, ref: 'Token', required: true, autopopulate: true},
    fee: {type: Number, required: true},
    tick: Number,
    sqrtPriceX96: String,
    liquidity: String,
  }, {_id: false, timestamps: true});
  static poolFactoryContract;
  static poolContractFactory;
  static cache;

  static {
    PoolModel.schema.plugin(autopopulate);

    PoolModel.schema.post(['init', 'save'], (doc) => {
      doc.contract = PoolModel.poolContractFactory(doc.address);
    });

    PoolModel.schema.pre('save', async function() {
      const ensureToken = async (id) => {
        let token = await PoolModel.TokenModel.findById(id);
        if (token === null) {
          token = await PoolModel.TokenModel.fromBlockchain(id);
          if (token) {
            try {await token.save(); }
            catch (e) { if (e.code !== 11000) throw e; }
          }
          else throw new Error(`Token ${id} not found in blockchain`);
        }
        return token;
      };

      await Promise.all([
        ensureToken(this.token0),
        ensureToken(this.token1)
      ])
      await this.populate('token0 token1');
    });

    const events = ['findOne', 'findById', 'find', 'findOneAndUpdate', 'findOneAndReplace', 'findOneAndDelete'];
    PoolModel.schema.post(events, async function(doc)  {
      if (!doc) return;

      async function populateTokens(doc) {
        for (const key of ['token0', 'token1']) {
          if (doc[key] === null) {
            doc.depopulate(key);
            doc[key] = await PoolModel.TokenModel.fromBlockchain(doc[key]);
            try {
              await doc[key].save();
            } catch (e) {
              if (e.code !== 11000) throw e;
            }
          }
        }
      }

      if (Array.isArray(doc)) {
        await Promise.all(doc.map(populateTokens));
      } else {
        await populateTokens(doc);
      }
    });
  }


  get chainId() { return Number(this._id.split(':')[0]); }
  get address() { return this._id.split(':')[1]; }

  tickToPrice(tick) {
    return tickToPrice(this.token0.toUniswapSDK(), this.token1.toUniswapSDK(), tick).toSignificant();
  }

  /**
   * Get pool price and price bounds for given position.
   * If position is not provided, returns current pool price.
   *
   * @param {PositionModel} [position]
   * @return {Promise<{current: string, lower: string, upper: string, tick: number, sqrtPriceX96: bigint}>}
   */
  getPrices(position = null) {
    const prices = {
      sqrtPriceX96: this.sqrtPriceX96,
      tick: this.tick,
      current: this.decodePrice(Number(this.sqrtPriceX96))
    };

    if (position) {
      prices.lower = this.tickToPrice(position.tickLower);
      prices.upper = this.tickToPrice(position.tickUpper);
    }

    //noinspection JSValidateTypes
    return prices;
  }

  /**
  * Decode sqrtPriceX96 from slot0 and return price in significant digits.
  *
  * @param {Number} sqrtPrice
  * @return {string}
  */
  decodePrice(sqrtPrice) {
    //noinspection JSCheckFunctionSignatures
    const price = new Price(
      this.token0.toUniswapSDK(),
      this.token1.toUniswapSDK(),
      (2n ** 192n).toString(),
      (BigInt(sqrtPrice) ** 2n).toString()
    );
    return price.toSignificant();
  }

  /**
  * Read pool slot0 data from blockchain.
  *
  * @return {Promise<{sqrtPriceX96: bigint, tick: number, observationIndex: bigint, observationCardinality: bigint, observationCardinalityNext: bigint, feeProtocol: number, unlocked: boolean}>}
  */
  async getSlot0() {
    let res = PoolModel.cache.get('slot0-'+this._id);
    if (!res) {
      res = await this.contract.read.slot0();
      res = {
        sqrtPriceX96: res[0],
        tick: res[1],
        observationIndex: res[2],
        observationCardinality: res[3],
        observationCardinalityNext: res[4],
        feeProtocol: res[5],
        unlocked: res[6]
      };
      PoolModel.cache.set('slot0'+this._id, res, 5);
    }
    return res;
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

    token0Balance = this.token0.format(token0Balance);
    token1Balance = this.token1.format(token1Balance);
    return (+token0Balance * +prices.current + +token1Balance).toFixed(this.token1.decimals);
  }

  async getLiquidity() {
    const liquidity = await this.contract.read.liquidity();
    return liquidity.toString();
  }

  /**
   * Refresh pool data from blockchain and save to db.
   * @return {Promise<PoolModel>}
   */
  async refresh() {
    const [slot0, liquidity] = await Promise.all([
      this.getSlot0(),
      this.contract.read.liquidity()
    ]);
    this.sqrtPriceX96 = slot0.sqrtPriceX96.toString();
    this.tick = slot0.tick;
    this.liquidity = liquidity.toString();
    return this;
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

            this.sqrtPriceX96 = sqrtPriceX96.toString();
            this.tick = tick;
            this.liquidity = liquidity.toString();
            this.updateOne({_id: this._id}, {
              sqrtPriceX96,
              tick,
              liquidity
            });

            const event = {
              tick,
              liquidity,
              prices: {
                sqrtPriceX96,
                tick,
                current: this.decodePrice(sqrtPriceX96)
              },
              amount0: this.token0.format(amount0),
              amount1: this.token1.format(amount1),
              protocolFeesToken0: this.token0.format(protocolFeesToken0),
              protocolFeesToken1: this.token1.format(protocolFeesToken1),
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

  toUniswapSDK() {
    return new UniswapPool(
      this.token0.toUniswapSDK(),
      this.token1.toUniswapSDK(),
      this.fee,
      this.sqrtPriceX96,
      this.liquidity,
      this.tick
    );
  }

  static async getPoolAddress(token0, token1, fee) {
    let address = await PoolModel.poolFactoryContract.read.getPool([token0, token1, fee]);
    if (!address || address === '0x0000000000000000000000000000000000000000') {
      throw new Error(`Pool not found onchain (${PoolModel.chainId}) for tokens ${token0}/${token1} with fee ${fee}`);
    }
    return address.toLowerCase();
  }

  /**
   * Fetch pool details from blockchain and return unsaved doc.
   * Use static chainId in this class, retreived from container.
   * @return {Promise<PoolModel>}
   * @param id Document ID
   */
  static async fromBlockchain(id) {
    let chainId, address;
    try { [chainId, address] = id.split(':'); }
    catch (e) { throw new Error('Invalid PoolModel: ' + id); }

    const contract = PoolModel.poolContractFactory(address);
    const [token0, token1, fee] = await Promise.all([
      contract.read.token0(),
      contract.read.token1(),
      contract.read.fee(),
    ]);
    const doc = new this({
      _id: id,
      chainId,
      token0: `${chainId}:${token0.toLowerCase()}`,
      token1: `${chainId}:${token1.toLowerCase()}`,
      fee
    });
    doc.contract = contract;
    return doc.refresh();
  }
}


module.exports = function(mongoose, cache, poolFactoryContract, poolContract, TokenModel) {
  PoolModel.poolFactoryContract = poolFactoryContract;
  PoolModel.poolContractFactory = poolContract;
  PoolModel.cache = cache;
  PoolModel.TokenModel = TokenModel;

  return mongoose.model('Pool', PoolModel.schema.loadClass(PoolModel));
}

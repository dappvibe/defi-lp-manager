const {Schema} = require("mongoose");
const { calculatePrice } = require('../../uniswap/utils');
const {tickToPrice} = require("@uniswap/v3-sdk");

const poolSchema = new Schema({
  _id: String, // chainId:address
  chainId: { type: Number, required: true }, // must be a field for search
  token0: { type: String, ref: 'Token', required: true },
  token1: { type: String, ref: 'Token', required: true },
  fee: { type: Number, required: true },
  priceMonitored: { type: Boolean, default: false },
  updatedAt: { type: Date, default: Date.now }
}, { _id: false });

poolSchema.virtual('address').get(function() { return this._id.split(':')[1]; });

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

  static id(chainId, address) { return `${chainId}:${address.toLowerCase()}`; }

  static async findOrCreate(chainId, token0, token1, fee) {
    token0 = token0.toLowerCase();
    token1 = token1.toLowerCase();

    let doc = await this.findOne({
      chainId,
      token0: PoolModel.tokenModel.id(chainId, token0),
      token1: PoolModel.tokenModel.id(chainId, token1),
      fee
    });
    if (!doc) {
      doc = await this.fromBlockchain(token0, token1, fee);
      await doc.save();
    }

    return doc;
  }

  static async fromBlockchain(token0, token1, fee) {
    // first find pool contract address from PoolFactoryV3
    const address = await PoolModel.poolFactoryContract.read.getPool([token0, token1, fee]);
    if (!address || address === '0x0000000000000000000000000000000000000000') {
      throw new Error(`Pool not found onchain (${PoolModel.chainId}) for tokens ${token0}/${token1} with fee ${fee}`);
    }

    // Make sure dependant tokens exists in the db
    token0 = await PoolModel.tokenModel.findOrCreate(PoolModel.chainId, token0);
    token1 = await PoolModel.tokenModel.findOrCreate(PoolModel.chainId, token1);

    const doc = new this;
    Object.assign(doc, {
      _id: PoolModel.id(PoolModel.chainId, address),
      chainId: PoolModel.chainId,
      address,
      token0: token0.getId(),
      token1: token1.getId(),
      fee
    });
    return doc;
  }

  async getPrices(position = null) {
    await this.populate('token0 token1');
    const slot0 = await this.slot0();
    const prices = {
      current: Number(calculatePrice(slot0.sqrtPriceX96, this.token0.decimals, this.token1.decimals)),
    };

    if (position) {
      prices.lower = Number(tickToPrice(this.token0.toUniswapSDK(), this.token1.toUniswapSDK(), position.tickLower).toSignificant());
      prices.upper = Number(tickToPrice(this.token0.toUniswapSDK(), this.token1.toUniswapSDK(), position.tickUpper).toSignificant());
    }

    return prices;
  }

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
}

poolSchema.loadClass(PoolModel);

module.exports = function(mongoose, chainId, poolFactoryContract, poolContract, tokenModel) {
  poolSchema.post('init', function(doc) {
    doc.contract = poolContract(doc.address);
  })
  poolSchema.post('save', function(doc) {
    doc.contract = poolContract(doc.address);
  })

  PoolModel.chainId = chainId;
  PoolModel.poolFactoryContract = poolFactoryContract;
  PoolModel.poolContract = poolContract;
  PoolModel.tokenModel = tokenModel;

  return mongoose.model('Pool', poolSchema);
}

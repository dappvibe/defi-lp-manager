const {Schema} = require("mongoose");
const { calculatePrice } = require('../../uniswap/utils');

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

class PoolModel {
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
      const address = await PoolModel.poolFactoryContract.read.getPool([token0, token1, fee]);
      if (!address || address === '0x0000000000000000000000000000000000000000') {
        throw new Error(`Pool not found onchain (${chainId}) for tokens ${token0.address}/${token1.address} with fee ${fee}`);
      }

      token0 = await PoolModel.tokenModel.findOrCreate(chainId, token0);
      token1 = await PoolModel.tokenModel.findOrCreate(chainId, token1);

      doc = await this.create({
        _id: PoolModel.id(chainId, address),
        chainId,
        address,
        token0: token0.getId(),
        token1: token1.getId(),
        fee
      });
    }

    return doc;
  }

  async slot0() {
    const [sqrtPriceX96, tick] = await this.contract.read.slot0();
    return {
      price: calculatePrice(sqrtPriceX96, this.token0.decimals, this.token1.decimals),
      sqrtPriceX96,
      tick
    }
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

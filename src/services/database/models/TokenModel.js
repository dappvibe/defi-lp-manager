const {Schema} = require("mongoose");
const tokenSchema = new Schema({
  _id: { type: String, required: true },
  address: { type: String, required: true, unique: true, index: true },
  chainId: { type: Number, required: true, index: true },
  symbol: { type: String, required: true, index: true },
  decimals: { type: Number, required: true },
  name: String,
  cachedAt: { type: Date, default: Date.now, index: true }
}, { _id: false });

// Set address as the primary key
tokenSchema.pre('save', function() {
  this._id = this.address;
});

class TokenModel {
  async get(address) {
    try {
      return await TokenModel.findById(address.toLowerCase()).lean();
    } catch (error) {
      console.error(`Error getting cached token for ${address}:`, error);
      return null;
    }
  }

  async save(address, chainId, tokenData) {
    try {
      const normalizedAddress = address.toLowerCase();
      const tokenDoc = {
        _id: normalizedAddress,
        address: normalizedAddress,
        chainId,
        ...tokenData,
        cachedAt: new Date()
      };

      await TokenModel.findByIdAndUpdate(
        normalizedAddress,
        tokenDoc,
        { upsert: true, new: true }
      );
    } catch (error) {
      console.error(`Error caching token for ${address}:`, error);
    }
  }

  async all() {
    try {
      return await TokenModel.find({}).lean();
    } catch (error) {
      console.error('Error getting all cached tokens:', error);
      return [];
    }
  }

  async clear() {
    try {
      await TokenModel.deleteMany({});
      console.log('Cleared token cache');
    } catch (error) {
      console.error('Error clearing token cache:', error);
    }
  }

  async remove(address) {
    try {
      await TokenModel.findByIdAndDelete(address.toLowerCase());
    } catch (error) {
      console.error(`Error removing token ${address} from cache:`, error);
    }
  }

  async findBySymbol(tokenSymbol) {
    try {
      return await TokenModel.find({
        symbol: { $regex: new RegExp(tokenSymbol, 'i') }
      });
    } catch (error) {
      console.error(`Error finding tokens by symbol ${tokenSymbol}:`, error.message);
      return [];
    }
  }

  async findByAddresses(addresses) {
    try {
      return await TokenModel.find({
        address: { $in: addresses }
      }).lean();
    } catch (error) {
      console.error('Error finding tokens by addresses:', error);
      return [];
    }
  }
}

tokenSchema.loadClass(TokenModel)
module.exports = (mongoose) => mongoose.model('Token', tokenSchema);

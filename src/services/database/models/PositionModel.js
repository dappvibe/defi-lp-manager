const {Schema} = require("mongoose");
const positionSchema = new Schema({
  tokenId: { type: String, required: true, index: true },
  walletAddress: { type: String, required: true, index: true },
  poolAddress: { type: String, index: true },
  chatId: { type: Number, index: true },
  messageId: { type: Number, index: true },
  token0Symbol: String,
  token1Symbol: String,
  isStaked: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now, index: true },
  updatedAt: { type: Date, default: Date.now }
});

// Compound indexes
positionSchema.index({ walletAddress: 1, tokenId: 1 }, { unique: true });

class PositionModel {
  async save(position) {
    try {
      const { tokenId, walletAddress, ...positionData } = position;
      const positionDoc = {
        tokenId,
        walletAddress,
        ...positionData,
        updatedAt: new Date()
      };

      await Position.findOneAndUpdate(
        { tokenId, walletAddress },
        positionDoc,
        { upsert: true, new: true }
      );
    } catch (error) {
      console.error(`Error saving position ${position.tokenId}:`, error.message);
    }
  }

  async get(tokenId, walletAddress) {
    try {
      return await Position.findOne({
        tokenId,
        walletAddress
      }).lean();
    } catch (error) {
      console.error(`Error getting position ${tokenId}:`, error.message);
      return null;
    }
  }

  async find(walletAddress) {
    try {
      return await Position.find({
        walletAddress
      }).lean();
    } catch (error) {
      console.error(`Error getting positions for wallet ${walletAddress}:`, error.message);
      return [];
    }
  }

  async remove(tokenId, walletAddress) {
    try {
      await Position.deleteOne({
        tokenId,
        walletAddress
      });
    } catch (error) {
      console.error(`Error removing position ${tokenId}:`, error.message);
    }
  }
}

positionSchema.loadClass(PositionModel);
module.exports = (mongoose) => mongoose.model('Position', positionSchema);

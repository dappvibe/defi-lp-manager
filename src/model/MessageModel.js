const {Schema} = require("mongoose");
const {isAddress} = require('viem');

/**
 * Store chat messages that is to be updated on blockchain changes.
 * Any existing document is a message to be updated.
 *
 * @property {String} _id - Composite key in format Type_refObject
 * @property {Number} chatId - Telegram chat ID
 * @property {Number} messageId - Telegram message ID
 * @property {Number} checksum - Message fingerprint for deduplication
 * @property {Object} metadata - Additional metadata
 * @property {String} type - Message type (Position, Range, etc.)
 * @property {String|null} positionId - Associated position ID if applicable
 * @property {Promise<PositionModel|null>} position - Associated position document if applicable
 * @property {Date} createdAt - Creation timestamp
 * @property {Date} updatedAt - Last update timestamp
 */
class MessageModel
{
  static TYPES = ['position', 'range'];
  static schema = new Schema({
    _id: { // TYPE_positionId (ex: position_1115111:nftManagerAddress:48592)
      type: String,
      lowercase: true,
      validate: function(v) {
        const [type, ref] = v.split('_');
        if (!MessageModel.TYPES.includes(type)) throw new Error('Invalid type: ' + v);
        const [chainId, address, tokenId] = ref.split(':');
        if (!/^\d+$/.test(chainId)) throw new Error('chainId is not numeric: ' + v);
        if (!isAddress(address)) throw new Error('Invalid address: ' + v);
        if (!/^\d+$/.test(tokenId)) throw new Error('Invalid tokenId: ' + v);
      }
    },
    chatId: { type: Number, required: true, min: 1 },
    messageId: { type: Number, required: true, min: 1 },
    checksum: Number,
    metadata: { type: Schema.Types.Mixed, default: {} },
  }, { _id: false, timestamps: true });

  static {
    MessageModel.schema.index({ chatId: 1, messageId: 1 }, { unique: true });
  }

  get type() {
    return this._id.split('_')[0];
  }

  get positionId() {
    if (!['position', 'range'].includes(this.type)) return null;
    return this._id.split('_')[1];
  }

  get position() {
    if (!['position', 'range'].includes(this.type)) return null;
    return this.model('Position').findById(this.positionId);
  }
}

module.exports = (mongoose) => {
  return mongoose.model('Message', MessageModel.schema.loadClass(MessageModel));
}

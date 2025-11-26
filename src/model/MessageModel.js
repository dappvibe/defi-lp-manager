const {Schema} = require("mongoose");
const autopopulate = require('mongoose-autopopulate');

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
  static schema = new Schema({
    _id: String, // Type_refObject (ex: Position_1115111:nftManagerAddress:48592)
    chatId: { type: Number, required: true },
    messageId: { type: Number, required: true },
    checksum: Number,
    metadata: { type: Schema.Types.Mixed, default: {} },
  }, { _id: false, timestamps: true });

  static {
    MessageModel.schema.index({ chatId: 1, messageId: 1 }, { unique: true });
    MessageModel.schema.plugin(autopopulate);
  }

  get type() {
    return this._id.split('_')[0];
  }

  get positionId() {
    if (!['Position', 'Range'].includes(this.type)) return null;
    return this._id.split('_')[1];
  }

  get position() {
    if (!['Position', 'Range'].includes(this.type)) return null;
    return this.model('Position').findById(this.positionId);
  }
}

module.exports = (mongoose) => {
  return mongoose.model('Message', MessageModel.schema.loadClass(MessageModel));
}

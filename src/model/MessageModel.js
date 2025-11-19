/**
 * Store chat messages that is to be updated on blockchain changes.
 * Any existing document is a message to be updated.
 */
const {Schema} = require("mongoose");

const messageSchema = new Schema({
  _id: String, // Type_refObject (ex: Position_1115111:48592)
  chatId: { type: Number, required: true },
  messageId: { type: Number, required: true },
  metadata: { type: Schema.Types.Mixed, default: {} },
}, { _id: false, timestamps: true });
messageSchema.index({ chatId: 1, messageId: 1 }, { unique: true });

// Virtuals
messageSchema.virtual('type').get(function () { return this._id.split('_')[0]; });

messageSchema.virtual('positionId').get(function () {
  if (!['Position', 'Range'].includes(this.type)) return null;
  return this._id.split('_')[1];
});

messageSchema.virtual('position').get(function () {
  if (!['Position', 'Range'].includes(this.type)) return null;
  return this.model('Position').findById(this.positionId);
});

//
class MessageModel {
}
messageSchema.loadClass(MessageModel);

module.exports = (mongoose) => mongoose.model('Message', messageSchema);

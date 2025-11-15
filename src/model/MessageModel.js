/**
 * Store chat messages that is to be updated on blockchain changes.
 * Any existing document is a message to be updated.
 */
const {Schema} = require("mongoose");

const messageSchema = new Schema({
  chatId: { type: Number, required: true },
  messageId: { type: Number, required: true },
  type: { type: String, required: true, index: true },
  metadata: { type: Schema.Types.Mixed, default: {} },
}, { timestamps: true });

class MessageModel {
}

messageSchema.index({ chatId: 1, messageId: 1 }, { unique: true });
messageSchema.index({ type: 1 });

messageSchema.loadClass(MessageModel);

module.exports = (mongoose) => mongoose.model('Message', messageSchema);

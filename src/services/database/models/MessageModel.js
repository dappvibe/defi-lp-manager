const PoolMessage = require("./PoolMessage");
const {Schema} = require("mongoose");

const messageSchema = new Schema({
  _id: {
    type: String,
    required: true,
  },
  chatId: {
    type: Number,
    required: true,
    index: true
  },
  messageId: {
    type: Number,
    required: true
  },
  type: {
    type: String,
    required: true,
    index: true
  },
  metadata: {
    type: Schema.Types.Mixed,
    default: {}
  },
}, {
  timestamps: true,
  collection: 'messages'
});

class MessageModel {
  // Static utility method for generating composite IDs
  static generateId(chatId, messageId) {
    return `${chatId}_${messageId}`;
  }

  // Save a TelegramMessage instance to database
  static async saveMessage(messageInstance) {
    const doc = new this({
      chatId: messageInstance.chatId,
      messageId: messageInstance.id,
      type: messageInstance.constructor.name,
      metadata: messageInstance.metadata || {}
    });

    return await doc.save();
  }

  // Create typed instance from database document
  static createTypedInstance(doc, originalClass) {
    if (!originalClass) {
      console.warn(`Cannot create typed instance: class not provided for type ${doc.type}`);
      return doc;
    }

    // Create new instance with same prototype
    const instance = Object.create(originalClass.prototype);

    // Copy basic properties
    instance.id = doc.messageId;
    instance.chatId = doc.chatId;
    instance.metadata = doc.metadata || {};

    // Initialize constructor (this will set up any default values)
    originalClass.call(instance);

    return instance;
  }
}

// Create compound index for efficient queries
messageSchema.index({ chatId: 1, messageId: 1 }, { unique: true });

// Pre-save middleware to automatically set the _id and type
messageSchema.pre('save', function(next) {
  if (!this._id && this.chatId && this.messageId) {
    this._id = MessageModel.generateId(this.chatId, this.messageId);
  }
  next();
});

// Pre-validate middleware for update operations
messageSchema.pre(['findOneAndUpdate', 'updateOne'], function(next) {
  const update = this.getUpdate();
  if (update.chatId && update.messageId && !update._id) {
    update._id = MessageModel.generateId(update.chatId, update.messageId);
  }
  next();
});

messageSchema.loadClass(MessageModel);

module.exports = (mongoose) => mongoose.model('Message', messageSchema);

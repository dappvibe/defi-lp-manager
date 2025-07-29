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
  constructor(chatId, messageId) {
    this.chatId = chatId;
    this.messageId = messageId;
  }

  generateId() {
    return `${this.chatId}_${this.messageId}`;
  };

  async find(poolAddress, chatId) {
    try {
      const compositeId = `${poolAddress}_${chatId}`;
      return await this.findById(compositeId).lean();
    } catch (error) {
      console.error(`Error getting pool message for ${poolAddress}:`, error.message);
      return null;
    }
  }

  // Pool Message methods
  async create(poolAddress, chatId, messageId, isMonitored = true) {
    try {
      const compositeId = `${poolAddress}_${chatId}`;
      const poolMessage = {
        _id: compositeId,
        poolAddress,
        chatId,
        messageId,
        isMonitored,
        updatedAt: new Date()
      };

      await PoolMessage.findByIdAndUpdate(
        compositeId,
        poolMessage,
        {upsert: true, new: true}
      );
    } catch (error) {
      console.error(`Error saving pool message for ${poolAddress}:`, error.message);
    }
  }

  async delete(poolAddress, chatId) {
    try {
      const compositeId = `${poolAddress}_${chatId}`;
      await PoolMessage.findByIdAndDelete(compositeId);

      console.log(`Removed pool message for ${poolAddress} in chat ${chatId}`);
    } catch (error) {
      console.error(`Error removing pool message for ${poolAddress}:`, error.message);
    }
  }

  async update(poolAddress, chatId, messageId) {
    try {
      const compositeId = `${poolAddress}_${chatId}`;
      await PoolMessage.findByIdAndUpdate(
        compositeId,
        {
          messageId,
          updatedAt: new Date()
        }
      );

      console.log(`Updated message ID for pool message ${poolAddress} in chat ${chatId}`);
    } catch (error) {
      console.error(`Error updating pool message ID for ${poolAddress}:`, error.message);
    }
  }

  async getMonitoredPoolMessages() {
    try {
      return await PoolMessage.find({
        isMonitored: true
      }).lean();
    } catch (error) {
      console.error('Error getting monitored pool messages:', error.message);
      return [];
    }
  }
}

// Create compound index for efficient queries
messageSchema.index({ chatId: 1, messageId: 1 }, { unique: true });

// Pre-save middleware to automatically set the _id based on chatId and messageId
messageSchema.pre('save', function(next) {
  if (!this._id) {
    this._id = this.constructor.generateId(this.chatId, this.messageId);
  }
  next();
});

messageSchema.loadClass(MessageModel);

module.exports = (mongoose) => mongoose.model('Message', messageSchema);

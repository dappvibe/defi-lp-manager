const { Schema } = require('mongoose');

const userSchema = new Schema({
  // _id is different for future UIs
  telegramId: {type: Number, required: true, index: true, unique: true},
  // chatId is not required since there is only one private chat per user
}, { timestamps: true });

userSchema.virtual('wallets', {
  ref: 'Wallet',
  localField: '_id',
  foreignField: 'userId',
  justOne: false,
  options: {
    sort: { createdAt: -1 }
  }
});

class UserModel {
}

userSchema.loadClass(UserModel);

module.exports = (mongoose) => mongoose.model('User', userSchema);

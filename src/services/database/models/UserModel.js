const { Schema } = require('mongoose');

const walletSubSchema = new Schema({
  network: {
    type: String,
    required: true,
  },
  address: {
    type: String,
    required: true,
    set: v => v.toLowerCase()
  },
}, { _id: false });

const userSchema = new Schema({
  telegramId: {
    type: Number,
    required: true,
    index: true,
    unique: true
  },
  wallets: [walletSubSchema],
  isAdmin: {
    type: Boolean,
    default: false
  }
});

class UserModel {
  static async getByTelegramId(telegramId) {
    try {
      return await this.findOne({ telegramId });
    } catch (e) {
      console.error(e);
      return null;
    }
  }

  static async addUser(telegramId) {
    try {
      return await this.create({ telegramId });
    } catch (e) {
      console.error(e);
      return null;
    }
  }

  getWallets(network) {
    return this.wallets.filter(wallet => wallet.network === network);
  }

  async addWallet(network, address) {
    const walletExists = this.wallets.some(
      w => w.address === address.toLowerCase() && w.network === network
    );

    if (walletExists) {
      return;
    }

    const wallet = { network, address: address.toLowerCase() };
    this.wallets.push(wallet);
    await this.save();
    return wallet;
  }

  async removeWallet(network, address) {
    try {
      this.wallets = this.wallets.filter(
        w => !(w.address === address.toLowerCase() && w.network === network)
      );
      await this.save();
    } catch (e) {
      console.error(e);
      return false;
    }
  }
}

userSchema.loadClass(UserModel);

module.exports = (mongoose) => mongoose.model('User', userSchema);

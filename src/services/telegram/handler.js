class AbstractHandler {
  constructor(userModel) {
    this.UserModel = userModel;
  }

  /**
   * Get user from database or create new user if not found.
   * Should NOT store in this.user so that changes in database are reflected.
   *
   * @param msg
   * @return Promise<UserModel>
   */
  async getUser(msg) {
    let user = await this.UserModel.getByTelegramId(msg.from.id);
    if (!user) { // not registered
      user = await this.UserModel.addUser(msg.from.id);
    }
    return user;
  }
}

module.exports = AbstractHandler;

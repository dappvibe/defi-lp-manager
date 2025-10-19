class AbstractHandler {
  constructor(userModel) {
    this.user = null;
    this.UserModel = userModel;
  }

  /**
   * Get user from database or create new user if not found.
   * Populates this.user with the user object.
   *
   * @param msg
   * @return User
   */
  async getUser(msg) {
    if (!this.user) {
      this.user = await this.UserModel.getByTelegramId(msg.from.id);
    }
    if (!this.user) { // not registered
      this.user = await this.UserModel.addUser(msg.from.id);
    }
    return this.user;
  }
}

module.exports = AbstractHandler;

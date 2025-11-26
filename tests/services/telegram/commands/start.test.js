describe('Telegram command: Start', () => {
  /**
   * @type {MockTelegram} telegram
   */
  let telegram;
  let handler;
  let msg;
  let user;
  let walletModel;

  beforeAll(async () => {
    telegram = container.resolve('telegram');
    handler = container.resolve('telegramCommand_start');
    telegram.addCommand('start', handler);
    user = await handler.UserModel.findOne({telegramId: 1});
    if (!user) throw new Error('Mock User (1) not found');
    msg = {
      message_id: 111,
      from: { id: 1, is_bot: false, first_name: 'Test', username: 'test_user' },
      chat: { id: 11 }
    }
    walletModel = container.resolve('WalletModel');
  });

  beforeEach(async () => {
    await walletModel.deleteMany({});
  })

  it('invite to add wallets if user has no wallets', async () => {
    expect.assertions(1);
    await handler.handle(msg, user);

    expect(telegram.sendMessage).toHaveBeenCalledWith(
      msg.chat.id,
      expect.stringContaining('don\'t have any wallets'),
      expect.anything()
    );
  });

  it('list wallets in message', async () => {
    expect.assertions(1);
    await walletModel.create({
      chainId: 42161,
      address: '0x1234567890abcdef',
      userId: user.id
    });

    await handler.handle(msg, user);

    expect(telegram.sendMessage).toHaveBeenCalledWith(
      msg.chat.id,
      expect.stringContaining('0x1234567890abcdef'),
      expect.anything()
    );
  })
});

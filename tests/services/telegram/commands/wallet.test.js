describe('Telegram command: Wallet', () => {
  /**
   * @type {MockTelegram} telegram
   */
  let telegram;
  let handler;
  let msg;
  let user;
  let walletModel;
  let chainId;

  beforeAll(async () => {
    telegram = container.resolve('telegram');
    handler = container.resolve('telegramCommand_wallet');
    telegram.addCommand('wallet', handler);
    user = await handler.UserModel.findOne({telegramId: 1});
    if (!user) throw new Error('Mock User (1) not found');
    msg = {
      message_id: 111,
      from: { id: 1, is_bot: false, first_name: 'Test', username: 'test_user' },
      chat: { id: 11 }
    }
    walletModel = container.resolve('WalletModel');
    chainId = container.resolve('chainId');
  });

  beforeEach(async () => {
    await walletModel.deleteMany({});
  })

  it('list wallets on /wallet and provide button to add', async () => {
    expect.assertions(1);
    await handler.listWallets(msg);

    expect(telegram.sendMessage).toHaveBeenCalledWith(
      msg.chat.id,
      expect.stringContaining('No wallets'),
      expect.objectContaining({
        reply_markup: {
          inline_keyboard: [
            [{ callback_data: 'add_wallet', text: expect.anything() }]
          ]
        }
      })
    );
  });

  it('query for wallet address on button click', async () => {
    expect.assertions(1);
    const query = {
      id: 100,
      data: 'add_wallet',
      message: msg,
    };
    await handler.promptWallet(query);

    expect(telegram.sendMessage).toHaveBeenCalledWith(
      msg.chat.id,
      expect.stringContaining('Send a wallet address'),
      expect.anything()
    );
  })

  it('saves wallet on prompt reply', async () => {
    expect.assertions(1);
    msg.text = USER_WALLET;
    const result = await handler.saveWallet(msg);
    expect(result).toBeTruthy();
  })

  it('removes wallet on callback', async () => {
    expect.assertions(1);
    await walletModel.deleteMany({});
    const wallet = await walletModel.create({
      userId: user._id,
      chainId: chainId,
      address: USER_WALLET
    });
    const query = {
      id: 100,
      data: `remove_wallet_${wallet.address}`,
      message: msg,
    };
    await handler.removeWallet(query);
    const updatedWallet = await walletModel.findById(wallet.id);
    expect(updatedWallet).toBeNull();
  });
});

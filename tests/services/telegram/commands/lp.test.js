describe('Telegram command: Lp', () => {
  let db;
  let telegram;
  let handler;
  let user;
  let walletModel;
  let chainId;
  let positionManager;
  let staker;
  let messageModel;
  let positionModel;
  let poolFactory;
  let erc20Factory;
  let positionId;

  let msg = {
    message_id: 111,
    from: { id: 1, is_bot: false, first_name: 'Test', username: 'test_user' },
    chat: { id: 11 }
  }

  beforeAll(async () => {
    db = container.resolve('db');
    telegram = container.resolve('telegram');
    handler = container.resolve('telegramCommand_lp');
    telegram.addCommand('lp', handler);
    user = await db.model('User').findOne({telegramId: 1});
    if (!user) user = await db.model('User').create({telegramId: 1});
    walletModel = container.resolve('WalletModel');
    messageModel = container.resolve('MessageModel');
    positionModel = container.resolve('PositionModel');
    chainId = container.resolve('chainId');
  });

  beforeEach(async () => {
    telegram.reset();
    telegram.typing = vi.fn().mockReturnValue(123);
    positionManager = container.resolve('positionManager');
    positionManager.reset();
    staker = container.resolve('staker');
    staker.reset();
    poolFactory = container.resolve('poolFactoryContract');
    erc20Factory = container.resolve('erc20Factory');

    positionId = '42161:0x46a15b0b27311cedf172ab29e4f4766fbe7f4364:31337';

    await walletModel.deleteMany({userId: user._id});
    await messageModel.deleteMany({});
    await positionModel.deleteMany({});
  })

  it('send No wallets message', async () => {
    await handler.handle(msg, user);

    expect(telegram.sendMessage).toHaveBeenCalledWith(
      msg.chat.id,
      expect.stringContaining('No wallets'),
      {}
    );
  });

  it('list positions for all wallets', async () => {
    await walletModel.create({
      userId: user._id,
      chainId: chainId,
      address: USER_WALLET
    });

    positionManager.setupPosition(31337, {
      owner: USER_WALLET,
      token0: WETH,
      token1: USDT,
      fee: 100
    });
    staker.setupUserPositionInfo(31337);

    await handler.handle(msg);

    expect(telegram.sendMessage).toHaveBeenCalled();
    const calls = telegram.sendMessage.mock.calls;
    const positionMessage = calls.find(call => call[1].includes('WETH'));
    expect(positionMessage).toBeDefined();
    expect(positionMessage[1]).toContain('WETH/USDT');
  });

  it('handles empty positions', async () => {
    await walletModel.create({
      userId: user._id,
      chainId: chainId,
      address: USER_WALLET
    });

    positionManager.setupPosition(31337, {
      owner: USER_WALLET,
      liquidity: 0n
    });

    await handler.handle(msg);

    expect(telegram.sendMessage).toHaveBeenCalledWith(
      msg.chat.id,
      expect.stringContaining('No active positions')
    );
  });

  describe('outputPosition', () => {
    it('creates new message for position', async () => {
      positionManager.setupPosition(31337, {
        owner: USER_WALLET,
        token0: WETH,
        token1: USDT,
        fee: 100
      });
      staker.setupUserPositionInfo(31337);

      const position = await positionModel.fromBlockchain(positionId);
      await position.populate('pool');
      await handler.outputPosition(position, {}, msg.chat.id);

      expect(telegram.sendMessage).toHaveBeenCalled();
      const savedMessage = await messageModel.findById('Position_' + position._id);
      expect(savedMessage).toBeDefined();
      expect(savedMessage.chatId).toBe(msg.chat.id);
    });

    it('updates existing message', async () => {
      positionManager.setupPosition(31337, {
        owner: USER_WALLET,
        token0: WETH,
        token1: USDT,
        fee: 100,
        tickLower: -10000,
        tickUpper: 10000
      });
      staker.setupUserPositionInfo(31337);

      const position = await positionModel.fromBlockchain(positionId);
      await handler.outputPosition(position, {}, msg.chat.id);

      telegram.reset();

      position.tickLower = -10001; // so that message is changed and sent

      await handler.outputPosition(position, {});
      expect(telegram.editMessageText).toHaveBeenCalled();
    });

    it('skips update if content unchanged', async () => {
      positionManager.setupPosition(31337, {
        owner: USER_WALLET,
        token0: WETH,
        token1: USDT,
        fee: 100
      });
      staker.setupUserPositionInfo(31337);

      const position = await positionModel.fromBlockchain(positionId);
      await handler.outputPosition(position, {}, msg.chat.id);

      telegram.reset();

      await handler.outputPosition(position, {});
      expect(telegram.editMessageText).not.toHaveBeenCalled();
    });

    it('should delete existing range alert when sending new position message', async () => {
      positionManager.setupPosition(31337, {
        owner: USER_WALLET
      });
      staker.setupUserPositionInfo(31337);
      const position = await positionModel.fromBlockchain(positionId);

      // Create a range alert
      await messageModel.create({
        _id: 'Range_' + position._id,
        chatId: msg.chat.id,
        messageId: 999
      });

      await handler.outputPosition(position, {}, msg.chat.id);

      const alert = await messageModel.findById('Range_' + position._id);
      expect(alert).toBeNull();
    });

    it('should throw error if updating position without chatId and no existing message', async () => {
      positionManager.setupPosition(31337, {
        owner: USER_WALLET
      });
      staker.setupUserPositionInfo(31337);
      const position = await positionModel.fromBlockchain(positionId);

      await expect(handler.outputPosition(position, {}))
        .rejects
        .toThrow('chatId must be set for new messages');
    });

    describe('PositionMessage content', () => {
      it('displays STAKED status', async () => {
        positionManager.setupPosition(31337, { owner: USER_WALLET });
        staker.setupUserPositionInfo(31337, { liquidity: 1000n });

        const position = await positionModel.fromBlockchain(positionId);
        await handler.outputPosition(position, {}, msg.chat.id);

        const call = telegram.sendMessage.mock.calls[0];
        expect(call[1]).toContain('🥩 STAKED');
      });

      it('displays UNSTAKED status', async () => {
        positionManager.setupPosition(31337, { owner: USER_WALLET });
        // skip staker position setup to simulate unstaked position

        const position = await positionModel.fromBlockchain(positionId);
        await handler.outputPosition(position, {}, msg.chat.id);
        const call = telegram.sendMessage.mock.calls[0];
        expect(call[1]).toContain('💼 UNSTAKED');
      });

      it('displays correct arrow for price below range', async () => {
        positionManager.setupPosition(31337, {
          owner: USER_WALLET,
          token0: WETH,
          token1: USDT,
          fee: 100,
          tickLower: -6000,
          tickUpper: -5000
        });
        staker.setupUserPositionInfo(31337);
        const position = await positionModel.fromBlockchain(positionId);
        await handler.outputPosition(position, {}, msg.chat.id);

        const call = telegram.sendMessage.mock.calls[0];
        expect(call[1]).toContain('🔴⬇️');
      });
    });
  });

  describe('alertPriceRange', () => {
    it('sends alert when position goes out of range', async () => {
      positionManager.setupPosition(31337, {
        owner: USER_WALLET,
        token0: WETH,
        token1: USDT,
        fee: 100
      });
      staker.setupUserPositionInfo(31337);
      telegram.reset();

      const position = await positionModel.fromBlockchain(positionId);
      await handler.outputPosition(position, {}, msg.chat.id);

      await db.model('Message').deleteMany({_id: /^Range_/});
      await handler.alertPriceRange(position, false);

      expect(telegram.sendMessage).toHaveBeenCalledWith(
        msg.chat.id,
        expect.stringContaining('Out of Range'),
        expect.anything()
      );

      const alert = await messageModel.findById('Range_' + position._id);
      expect(alert).toBeDefined();
    });

    it('removes alert when position comes back in range', async () => {
      positionManager.setupPosition(31337, {
        owner: USER_WALLET,
        token0: WETH,
        token1: USDT,
        fee: 100
      });
      staker.setupUserPositionInfo(31337);

      const position = await positionModel.fromBlockchain(positionId);
      await handler.outputPosition(position, {}, msg.chat.id);
      await handler.alertPriceRange(position, false);

      const alert = await messageModel.findById('Range_' + position._id);
      expect(alert).toBeDefined();

      await handler.alertPriceRange(position, true);

      const removedAlert = await messageModel.findById('Range_' + position._id);
      expect(removedAlert).toBeNull();
    });

    it('does not send duplicate alerts', async () => {
      positionManager.setupPosition(31337, {
        owner: USER_WALLET
      });
      staker.setupUserPositionInfo(31337);

      const position = await positionModel.fromBlockchain(positionId);
      await handler.outputPosition(position, {}, msg.chat.id);

      await handler.alertPriceRange(position, false);
      telegram.reset();
      await handler.alertPriceRange(position, false);

      expect(telegram.sendMessage).not.toHaveBeenCalled();
    });

    it('should not send alert if position message is missing', async () => {
      positionManager.setupPosition(31337, {
        owner: USER_WALLET,
        token0: WETH,
        token1: USDT,
        fee: 100
      });
      staker.setupUserPositionInfo(31337);
      const position = await positionModel.fromBlockchain(positionId);

      // Ensure no position message exists
      await messageModel.deleteOne({_id: 'Position_' + position._id});

      await handler.alertPriceRange(position, false);

      expect(telegram.sendMessage).not.toHaveBeenCalled();
    });

    it('should not send alert if already processing (onAir)', async () => {
      positionManager.setupPosition(31337, {
        owner: USER_WALLET,
        token0: WETH,
        token1: USDT,
        fee: 100
      });
      staker.setupUserPositionInfo(31337);
      const position = await positionModel.fromBlockchain(positionId);
      await handler.outputPosition(position, {}, msg.chat.id);

      handler.onAir['Range_' + position._id] = true;

      telegram.reset();
      await handler.alertPriceRange(position, false);

      expect(telegram.sendMessage).not.toHaveBeenCalled();

      // Cleanup
      delete handler.onAir['Range_' + position._id];
    });
  });

  describe('setEventListeners', () => {
    it('starts monitoring and sets event handlers', async () => {
      positionManager.setupPosition(31337, {
        owner: USER_WALLET
      });
      staker.setupUserPositionInfo(31337);

      const position = await positionModel.fromBlockchain(positionId);
      const startMonitoringSpy = vi.spyOn(position, 'startMonitoring');
      const onSpy = vi.spyOn(position, 'on');

      handler.setEventListeners(position);

      expect(startMonitoringSpy).toHaveBeenCalled();
      expect(onSpy).toHaveBeenCalledWith('swap', expect.any(Function));
      expect(onSpy).toHaveBeenCalledWith('range', expect.any(Function));
    });
  });

  describe('restoreEventListeners', () => {
    it('restores monitoring for saved positions', async () => {
      positionManager.setupPosition(31337, {
        owner: USER_WALLET
      });
      staker.setupUserPositionInfo(31337);

      const position = await positionModel.fromBlockchain(positionId);
      await position.save();
      await messageModel.create({
        _id: 'Position_' + position._id,
        chatId: msg.chat.id,
        messageId: 123
      });

      const count = await handler.restoreEventListeners();

      expect(count).toBe(1);
    });

    it('handles missing positions gracefully', async () => {
      await messageModel.create({
        _id: 'Position_42161:0xnonexistent',
        chatId: msg.chat.id,
        messageId: 123
      });

      const count = await handler.restoreEventListeners();

      expect(count).toBe(0);
    });
  });

  describe('getMyCommand', () => {
    it('returns command definition', () => {
      const [name, description] = handler.getMyCommand();

      expect(name).toBe('lp');
      expect(description).toBeDefined();
      expect(typeof description).toBe('string');
    });
  });
});

describe('MessageModel', () => {
  let messages, positions;
  let position;
  let positionManager;
  let chainId;

  beforeAll(async () => {
    const db = container.resolve('db');
    messages = db.model('Message');
    positions = db.model('Position');
    positionManager = container.resolve('positionManager');
    chainId = container.resolve('chainId');
  });

  beforeEach(async () => {
    await messages.deleteMany({}); // Clean-up before tests
    await positions.deleteMany({_id: new RegExp(`^${chainId}`)});
    position = await positions.fromBlockchain(`${chainId}:${positionManager.address}:31337`);
    try {
      position = await position.save();
    } catch (e) {
      if (e.code !== 11000) throw e;
    }
  });

  describe('schema & instance methods', () => {
    it('should correctly extract the type from _id', async () => {
      const data = {
        _id: 'Position_' + position.id,
        chatId: 42,
        messageId: 123,
        checksum: 456789,
        metadata: { key: 'value' },
      };

      const message = await messages.create(data);
      expect(message.type).toBe('Position'); // Derived from the _id prefix
    });

    it('should correctly extract positionId if applicable', async () => {
      const data = {
        _id: 'Range_1:0xtest:7890',
        chatId: 11,
        messageId: 22,
      };

      const message = await messages.create(data);
      expect(message.positionId).toBe('1:0xtest:7890'); // Extracted based on allowed types
    });

    it('should return null for positionId if type is invalid', async () => {
      const data = {
        _id: 'InvalidType_1:0xunknown:1111',
        chatId: 33,
        messageId: 44,
      };

      const message = await messages.create(data);
      expect(message.positionId).toBeNull(); // Invalid types do not have positionId
    });
  });

  describe('static methods and behavior', () => {
    it('should prevent duplicate entries with the same chatId and messageId', async () => {
      const data = {
        _id: 'Position_1:testAddress:1',
        chatId: 10,
        messageId: 123,
      };

      await messages.create(data);

      // Attempt a duplicate entry
      await expect(messages.create(data)).rejects.toThrow(/duplicate key error/i);
    });

    it('should populate metadata correctly', async () => {
      const data = {
        _id: 'Position_42161:testRef:1',
        chatId: 1,
        messageId: 2,
        metadata: { testKey: 'testValue' },
      };

      const message = await messages.create(data);
      expect(message.metadata.testKey).toBe('testValue');
    });
  });

  describe('timestamps', () => {
    it('should automatically set createdAt and updatedAt fields', async () => {
      const now = Date.now();

      const data = {
        _id: 'Position_42161:timestampCheck:1',
        chatId: 50,
        messageId: 99,
      };

      const message = await messages.create(data);

      expect(message.createdAt).toBeDefined();
      expect(message.updatedAt).toBeDefined();

      expect(new Date(message.createdAt).getTime()).toBeGreaterThanOrEqual(now);
      expect(new Date(message.updatedAt).getTime()).toBeGreaterThanOrEqual(now);
    });

    it('should update updatedAt field on document modification', async () => {
      const data = {
        _id: 'Position_testupdate:2',
        chatId: 25,
        messageId: 55,
      };

      const message = await messages.create(data);
      const originalUpdatedAt = message.updatedAt;

      // Wait for 1 second to ensure updatedAt field changes
      await new Promise((resolve) => setTimeout(resolve, 1000));
      message.checksum = 9999;

      await message.save();

      expect(message.updatedAt).toBeDefined();
      expect(message.updatedAt.getTime()).toBeGreaterThan(originalUpdatedAt.getTime());
    });
  });

  describe('indexes', () => {
    it('should enforce unique constraint on (chatId, messageId)', async () => {
      const data1 = {
        _id: 'Position_example:1',
        chatId: 123,
        messageId: 456,
      };

      const data2 = {
        _id: 'Position_example:2',
        chatId: 123,
        messageId: 456, // Duplicate messageId in the same chatId
      };

      await messages.create(data1);

      // Ensure duplicate submission throws an error
      await expect(messages.create(data2)).rejects.toThrow(/duplicate key error/i);
    });
  });
});

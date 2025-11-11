describe('PositionModel', () => {
  describe('readBlockchain', () => {
    it('should return position data as map', async () => {
      const model = container.resolve('positionModel');
      const mockData = [
        null, null,
        '0x1234567890abcdef', '0xabcdef1234567890',
        3000, -200, 200, 1000000n
      ];

      model.positionManager = {
        read: {
          positions: vi.fn().mockResolvedValue(mockData)
        }
      };
      model.tokenId = 123;

      const result = await model.readBlockchain(model.tokenId);

      expect(result).toEqual({
        token0: '0x1234567890abcdef',
        token1: '0xabcdef1234567890',
        fee: 3000,
        tickLower: -200,
        tickUpper: 200,
        liquidity: 1000000n
      });
    });
  });

  describe('findOrCreate', () => {
    it('should create position if not exists', async () => {
      const model = container.resolve('positionModel');
      const chainId = 1;
      const tokenId = 12345;

      model.poolModel = {findOrCreate: vi.fn().mockResolvedValue('pool123')};
      model.positionManager = {
        read: {
          positions: vi.fn().mockResolvedValue([
            null, null, '0xtoken0', '0xtoken1', 3000, -200, 200, 1000n
          ])
        }
      };

      const result = await model.findOrCreate(chainId, tokenId, 1);

      expect(result.chainId).toBe(chainId);
      expect(result.tokenId).toBe(tokenId);
    });
  });

  describe('calculateUnclaimedFees', () => {
    it('should calculate unclaimed fees', async () => {
      const model = container.resolve('positionModel');

      const position = await model.findOrCreate(42161, 302731, 0);
      position.liquidity = 100n; // to actually run the method

      const fees = await position.calculateUnclaimedFees();

      expect(fees).toBeDefined();
      expect(fees).not.toBe({});
    });
  });

  describe('calculateTokenAmounts', () => {
    it('should calculate readable token amounts', async () => {
      const model = container.resolve('positionModel');

      const position = await model.findOrCreate(42161, 302731, 0);

      const amounts = await position.calculateTokenAmounts();

      expect(amounts).toBeDefined();
      expect(amounts).not.toBeGreaterThan(0);
    });
  });

  describe('calculateCombinedValue', () => {
    it('should calculate readable tokens total amount', async () => {
      const model = container.resolve('positionModel');

      const position = await model.findOrCreate(42161, 302731, 0);

      const total = await position.calculateCombinedValue();

      expect(total).toBeDefined();
    });
  });
});

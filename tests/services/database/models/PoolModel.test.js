describe('PoolModel', () => {
  let model;

  beforeAll(() => {
    model = container.resolve('poolModel');
  })

  describe('findOrCreate', () => {
    it('should create a new token document if it does not exist', async () => {
      const chainId = 1;
      const token0 = '0x82af49447d8a07e3bd95bd0d56f35241523fbab1'; // WETH
      const token1 = '0xaf88d065e77c8cC2239327C5EDb3A432268e5831'; // USDC
      const fee = 100;
      await model.findOrCreate(chainId, token0, token1, fee).then(pool => {
        expect(pool).toBeDefined();
        expect(pool._id).toBeDefined();
        expect(pool.contract).toBeDefined();
      });
    })
  });

  describe('getPrices', () => {
    it('should return current price without position', async () => {
      const model = container.resolve('poolModel');
      const chainId = 1;
      const token0 = '0x82af49447d8a07e3bd95bd0d56f35241523fbab1';
      const token1 = '0xaf88d065e77c8cC2239327C5EDb3A432268e5831';
      const fee = 100;

      const pool = await model.findOrCreate(chainId, token0, token1, fee);
      const prices = await pool.getPrices();

      expect(prices).toBeDefined();
      expect(prices.current).toBeDefined();
      expect(typeof prices.current).toBe('number');
      expect(prices.lower).toBeUndefined();
      expect(prices.upper).toBeUndefined();
    });

    it('should return current and position prices with position', async () => {
      const model = container.resolve('poolModel');
      const chainId = 1;
      const token0 = '0x82af49447d8a07e3bd95bd0d56f35241523fbab1';
      const token1 = '0xaf88d065e77c8cC2239327C5EDb3A432268e5831';
      const fee = 100;

      const pool = await model.findOrCreate(chainId, token0, token1, fee);
      const position = { tickLower: -276324, tickUpper: -276320 };
      const prices = await pool.getPrices(position);

      expect(prices).toBeDefined();
      expect(prices.current).toBeDefined();
      expect(typeof prices.current).toBe('number');
      expect(prices.lower).toBeDefined();
      expect(prices.upper).toBeDefined();
    });
  });

  describe('getTVL', () => {
    it('should return values', async () => {
      const chainId = 42161;
      const token0 = '0x82af49447d8a07e3bd95bd0d56f35241523fbab1'; // WETH
      const token1 = '0xaf88d065e77c8cC2239327C5EDb3A432268e5831'; // USDC
      const fee = 100;
      const doc = await model.findOrCreate(chainId, token0, token1, fee);

      const tvl = await doc.getTVL();
      expect(tvl).toBeGreaterThan(0);
    })
  });

  describe('swap listener', () => {
    it('should emit events', async () => {
      const chainId = 42161;
      const token0 = '0x82af49447d8a07e3bd95bd0d56f35241523fbab1'; // WETH
      const token1 = '0xaf88d065e77c8cC2239327C5EDb3A432268e5831'; // USDC
      const fee = 100;
      const doc = await model.findOrCreate(chainId, token0, token1, fee);
      await doc.populate('token0 token1');

      // sample
      const logs = [
        {
          args: {
            sender: '0x27920e8039d2b6E93e36F5D5f53B998e2e631a70',
            recipient: '0x51C72848c68a965f66FA7a88855F9f7784502a7F',
            amount0: 85177457593895947n,
            amount1: -304831867n,
            sqrtPriceX96: 4739784103548144228237312n,
            liquidity: 104514947186900879n,
            tick: -194492,
            protocolFeesToken0: 2810856100598n,
            protocolFeesToken1: 0,
          }
        }
      ];

      let onLogsCallback;
      doc.contract.watchEvent = {
        Swap: vi.fn((filter, options) => {
          onLogsCallback = options.onLogs;
          return () => {};
        })
      };

      const event = await new Promise((resolve) => {
        doc.once('swap', resolve);
        doc.startMonitoring().then(() => {
          onLogsCallback(logs);
        });
      });

      expect(event.amount0).eq('0.085177457593895958');
      expect(event.amount1).eq('-304.831867');
      expect(event.price).eq(3578.96913182);
      expect(event.tick).toBe(-194492);
      expect(event.protocolFeesToken0).eq('0.000002810856100598');
      expect(event.protocolFeesToken1).eq('0.000000');
      expect(event.liquidity).eq(104514947186900879n);
    })
  });
});

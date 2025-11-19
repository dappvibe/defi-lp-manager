describe('PoolModel', () => {
  let model;
  let chainId;

  beforeEach(() => {
    model = container.resolve('PoolModel');
    chainId = container.resolve('chainId');
    return model.deleteMany({chainId});
  })

  describe('fromBlockchain', () => {
    it('should fetch pool details and return new doc', async () => {
      const fee = 100;
      const pool = await model.fromBlockchain(WETH, USDT, fee);
      expect(pool).toBeDefined();
      expect(pool.isNew).toBe(true); // unsaved
      expect(pool._id).toBe(`${chainId}:0x389938cf14be379217570d8e4619e51fbdafaa21`);
      expect(pool.token0.address).toBe(WETH);
      expect(pool.token1.address).toBe(USDT);
      expect(pool.fee).toBe(fee);
    })
  });

  describe('fetch', () => {
    it('should create a new token document if it does not exist', async () => {
      const fee = 100;
      await model.fetch(WETH, USDT, fee).then(pool => {
        expect(pool).toBeDefined();
        expect(pool._id).toBeDefined();
        expect(pool.contract).toBeDefined();
        expect(pool.token0.address).toBe(WETH);
        expect(pool.token1.address).toBe(USDT);
      });
    })

    it('should handle concurrent pool creation', async () => {
      const fee = 100;
      const pools = await Promise.all([
        model.fetch(WETH, USDT, fee),
        model.fetch(WETH, USDT, fee),
        model.fetch(WETH, USDT, fee)
      ]);

      expect(pools[0]._id).toBeDefined();
      expect(pools[0]._id).toBe(pools[1]._id);
      expect(pools[1]._id).toBe(pools[2]._id);
    })
  });

  describe('getPrices', () => {
    it('should return current price without position', async () => {
      let pool = await model.fetch(WETH, USDT, 100);
      let prices = await pool.getPrices();
      expect(prices).toBeDefined();
      expect(prices.current).eq('3499.99');
      expect(prices.lower).toBeUndefined();
      expect(prices.upper).toBeUndefined();

      pool = await model.fetch(USDC, USDT, 100);
      prices = await pool.getPrices();
      expect(prices).toBeDefined();
      expect(prices.current).eq('1.01');
      expect(prices.lower).toBeUndefined();
      expect(prices.upper).toBeUndefined();
    });

    it('should return current and position prices with position', async () => {
      const pool = await model.fetch(USDC, USDT, 100);
      const prices = await pool.getPrices({
        tickLower: -10, tickUpper: 10
      });
      expect(prices).toBeDefined();
      expect(prices.current).eq('1.01');
      expect(prices.lower).eq('0.999001');
      expect(prices.upper).eq('1.001');
    });
  });

  describe('getTVL', () => {
    it('should return values', async () => {
      const doc = await model.fetch(WETH, USDT, 100);
      doc.token0.contract.setBalance(doc.address, 1000_000000012432075234n);
      doc.token1.contract.setBalance(doc.address, 100000_000538n);
      // price is static in pool mock

      const tvl = await doc.getTVL();
      expect(tvl).eq('3599990.000582');
    })
  });

  describe('swap listener', () => {
    it('should emit events', async () => {
      const fee = 100;
      const doc = await model.fetch(WETH, USDT, fee);

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
        doc.startMonitoring();
        onLogsCallback(logs);
      });

      expect(event.amount0).eq('0.085177457593895947');
      expect(event.amount1).eq('-304.831867');
      expect(event.prices.current).eq('3578.97');
      expect(event.tick).toBe(-194492);
      expect(event.protocolFeesToken0).eq('0.000002810856100598');
      expect(event.protocolFeesToken1).eq('0');
      expect(event.liquidity).eq(104514947186900879n);
    })
  });
});

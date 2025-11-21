describe('PoolModel', () => {
  let db;
  let model;
  let chainId;
  let pool; // WETH/USDC instance

  beforeAll(() => {
    db = container.resolve('db');
    model = db.model('Pool');
    chainId = container.resolve('chainId');
  })

  beforeEach(async () => {
    await model.deleteMany({chainId});
    pool = await model.fromBlockchain(`${chainId}:0x17c14d2c404d167802b16c450d3c99f88f2c4f4d`);
    try {pool = await pool.save();} catch (e) { if (e.code !== 11000) throw e;}
  })

  it('populates tokens even if they not exist in db', async () => {
    await model.deleteMany({});

    const query = {
      token0: `${chainId}:${WETH}`,
      token1: `${chainId}:${USDT}`,
      fee: 100
    };
    const check = (pool, msg) => {
      expect(pool, msg).not.toBeNull();
      expect(pool.token0).not.toBeNull();
      expect(pool.token1).not.toBeNull();
      expect(pool.token0?.address, msg).toBe(WETH);
      expect(pool.token1?.address, msg).toBe(USDT);
    }

    await db.model('Token').deleteMany({});
    let pool = await model.create({...query, _id: chainId+':0xfoobar'});
    check(pool, 'create()');

    await db.model('Token').deleteMany({});
    pool = await model.findOne(query);
    check(pool, 'findOne()');

    await db.model('Token').deleteMany({});
    pool = await model.findOneAndUpdate(
      {_id: pool._id},
      {_id: pool._id, liquidity: 999},
      {upsert: true, new: true, setDefaultsOnInsert: true}
    );
    check(pool, 'findOneAndUpdate()');

    // find multiple
    await model.create({...query, _id: chainId+':0xbarbaz'});
    await db.model('Token').deleteMany({});
    pool = await model.find({fee: 100});
    expect(pool.length).toBe(2);
    pool.forEach(check, 'find() with filter');

    // not found
    pool = await model.findById('notexist');
    expect(pool).toBeNull(); // no exceptions
  });

  describe('fromBlockchain', () => {
    it('should fetch pool details and return new pool', async () => {
      const pool = await model.fromBlockchain(`${chainId}:0x17c14d2c404d167802b16c450d3c99f88f2c4f4d`);
      expect(pool).toBeDefined();
      expect(pool.isNew).toBe(true); // unsaved
      expect(pool._id).toBe(`${chainId}:0x17c14d2c404d167802b16c450d3c99f88f2c4f4d`);
      expect(pool.chainId).toBe(chainId);
      expect(pool.address).toBe('0x17c14d2c404d167802b16c450d3c99f88f2c4f4d');
      expect(pool.token0).toBe(`${chainId}:0x82af49447d8a07e3bd95bd0d56f35241523fbab1`);
      expect(pool.token1).toBe(`${chainId}:0xaf88d065e77c8cc2239327c5edb3a432268e5831`);
      expect(pool.sqrtPriceX96).toBe('4687542788683472901042208');
      expect(pool.liquidity).toBe('1000000');
      expect(pool.fee).toBe(100);
    })
  });

  describe('getPrices', () => {
    it('should return current price without position', async () => {
      let prices = await pool.getPrices();
      expect(prices).toBeDefined();
      expect(prices.current).eq('3500.51');
      expect(prices.lower).toBeUndefined();
      expect(prices.upper).toBeUndefined();
    });

    it('should return current and position prices with position', async () => {
      const pool = await model.fromBlockchain(`${chainId}:0x641c00a822e8b671738d32a431a4fb6074e5c79d`);
      await pool.save();
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
      pool.token0.contract.setBalance(pool.address, 1000_000000012432075234n);
      pool.token1.contract.setBalance(pool.address, 100000_000538n);
      const tvl = await pool.getTVL();
      expect(tvl).eq('3600510.000582');
    })
  });

  describe('swap listener', () => {
    it('should emit events', async () => {
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
      pool.contract.watchEvent = {
        Swap: vi.fn((filter, options) => {
          onLogsCallback = options.onLogs;
          return () => {};
        })
      };

      const event = await new Promise((resolve) => {
        pool.once('swap', resolve);
        pool.startMonitoring();
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

describe('PoolModel', () => {
  let pools, tokens;
  let chainId;
  let pool; // SUT - WETH/USDC instance
  let ethnode;

  beforeAll(() => {
    const db = container.resolve('db');
    pools = db.model('Pool');
    tokens = db.model('Token');
    chainId = container.resolve('chainId');
    ethnode = container.resolve('ethnode');
  })

  beforeEach(async () => {
    await tokens.deleteMany({_id: new RegExp(`^${chainId}`)});
    await pools.deleteMany({_id: new RegExp(`^${chainId}`)});
    pool = await pools.create({
      _id: `${chainId}:${WETH_USDC}`,
      token0: `${chainId}:${WETH}`,
      token1: `${chainId}:${USDC}`,
      fee: 100,
    });
    await pool.refresh().then(p => p.save()); // liquidity and price
  })

  it('populates tokens even if they not exist in db', async () => {
    await pools.deleteMany({});

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

    await tokens.deleteMany({});
    let pool;
    try {
      pool = await pools.create({...query, _id: chainId+':0xfoobar'});
    } catch (e) { if(e.code !== 11000) throw e; }
    check(pool, 'create()');

    await tokens.deleteMany({});
    pool = await pools.findOne(query);
    check(pool, 'findOne()');

    await tokens.deleteMany({});
    pool = await pools.findOneAndUpdate(
      {_id: pool._id},
      {_id: pool._id, liquidity: 999},
      {upsert: true, new: true, setDefaultsOnInsert: true}
    );
    check(pool, 'findOneAndUpdate()');

    // find multiple
    await pools.create({...query, _id: chainId+':0xbarbaz'});
    await tokens.deleteMany({});
    pool = await pools.find({fee: 100});
    expect(pool.length).toBe(2);
    pool.forEach(check, 'find() with filter');

    // not found
    pool = await pools.findById('notexist');
    expect(pool).toBeNull(); // no exceptions
  });

  describe('fromBlockchain', () => {
    it('should fetch pool details and return new pool', async () => {
      const obj = await pools.fromBlockchain(`${chainId}:${WETH_USDC}`);
      expect(obj).toBeDefined();
      expect(obj.isNew).toBe(true); // unsaved
      expect(obj._id).toBe(`${chainId}:${WETH_USDC}`);
      expect(obj.chainId).toBe(chainId);
      expect(obj.address).toBe(WETH_USDC);
      expect(obj.token0).toBe(`${chainId}:${WETH}`);
      expect(obj.token1).toBe(`${chainId}:${USDC}`);
      expect(obj.sqrtPriceX96).toBe(pool.sqrtPriceX96);
      expect(obj.liquidity).toBe(pool.liquidity);
      expect(obj.fee).toBe(100);
    })
  });

  describe('getPrices', () => {
    it('should return current price without position', async () => {
      let prices = await pool.getPrices();
      expect(prices).toBeDefined();
      expect(prices.current).eq('2935.59');
      expect(prices.lower).toBeUndefined();
      expect(prices.upper).toBeUndefined();
    });

    it('should return current and position prices with position', async () => {
      const prices = await pool.getPrices({
        tickLower: -197000, tickUpper: -196000
      });
      expect(prices).toBeDefined();
      expect(prices.current).eq('2935.59');
      expect(prices.lower).eq('2785.01');
      expect(prices.upper).eq('3077.89');
    });
  });

  describe('getTVL', () => {
    it('should return values', async () => {
      await ethnode.forCall(WETH)
        .forFunction('function balanceOf(address account) external view returns (uint256)')
        .withParams([pool.address])
        .thenReturn([1000_000000012432075234n]);
      await ethnode.forCall(USDC)
        .forFunction('function balanceOf(address account) external view returns (uint256)')
        .withParams([pool.address])
        .thenReturn([100000_000538n]);

      const tvl = await pool.getTVL();
      expect(tvl).eq('3035590.000574');
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

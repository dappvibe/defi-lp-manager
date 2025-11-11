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
});

describe('PoolModel', () => {
  describe('findOrCreate', () => {
    it('should create a new token document if it does not exist', async () => {
      const model = container.resolve('poolModel');
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
});

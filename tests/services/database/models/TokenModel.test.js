describe('TokenModel', () => {
  let model;

  beforeAll(() => {
    model = container.resolve('tokenModel');
  })

  describe('findOrCreate', () => {
    it('should create a new token document if it does not exist', async () => {
      const chainId = 1;
      const address = '0x82af49447d8a07e3bd95bd0d56f35241523fbab1'; // WETH
      await model.findOrCreate(chainId, address).then(token => {
        expect(token).toBeDefined();
        expect(token.chainId).toBe(chainId);
        expect(token.address).toBe(address);
      });
    })
  });

  describe('getFloatAmount', () => {
    it('should return readable value', async() => {
      const chainId = 42161;
      const address = '0x82af49447d8a07e3bd95bd0d56f35241523fbab1'; // WETH
      const eth = await model.findOrCreate(chainId, address);
      const usd = await model.findOrCreate(chainId, '0xaf88d065e77c8cc2239327c5edb3a432268e5831');

      let amount = eth.getFloatAmount(-141165908562470027n);
      expect(amount).toBe('-0.141165908562470022'); // 18 decimals
      amount = usd.getFloatAmount(502745000n);
      expect(amount).toBe('502.745000'); // 6 decimals
    })
  })
});

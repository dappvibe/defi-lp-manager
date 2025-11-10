describe('TokenModel', () => {
  describe('findOrCreate', () => {
    it('should create a new token document if it does not exist', async () => {
      const model = container.resolve('tokenModel');
      const chainId = 1;
      const address = '0x82af49447d8a07e3bd95bd0d56f35241523fbab1'; // WETH
      await model.findOrCreate(chainId, address).then(token => {
        expect(token).toBeDefined();
        expect(token.chainId).toBe(chainId);
        expect(token.address).toBe(address);
      });
    })
  });
});

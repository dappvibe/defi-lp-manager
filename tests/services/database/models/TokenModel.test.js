describe('TokenModel', () => {
  let model;
  let chainId;
  let WETH = '0x82af49447d8a07e3bd95bd0d56f35241523fbab1';
  let USDT = '0xaf88d065e77c8cc2239327c5edb3a432268e5831';

  beforeAll(() => {
    model = container.resolve('tokenModel');
    chainId = container.resolve('chainId');
    return model.deleteMany({chainId});
  })

  beforeEach(() => {
    // reset spyOn() counters
    const mocks = container.resolve('erc20Factory');
    mocks(WETH).reset();
    mocks(USDT).reset();
  })

  describe('fromBlockchain', () => {
    it('should fetch token details and return new doc', async () => {
      const token = await model.fromBlockchain(WETH);
      expect(token).toBeDefined();
      expect(token.chainId).toBe(chainId);
      expect(token.address).toBe(WETH);
      expect(token.decimals).eq(18);
      expect(token.symbol).eq('WETH');
      expect(token.isNew).toBe(true); // unsaved
    })
  });

  describe('fetch', () => {
    it('should create a new token document if it does not exist', async () => {
      await model.fetch(WETH).then(token => {
        expect(token).toBeDefined();
        expect(token.chainId).toBe(chainId);
        expect(token.address).toBe(WETH);
        expect(token.contract).toBeDefined();
      });

      await model.fetch(WETH).then(token => {
        expect(token.contract.read.symbol, 'Subsequent calls must return saved doc')
          .toBeCalledTimes(1);
      });
    })

    it('should handle concurrent calls', async () => {
      const [token1, token2] = await Promise.all([
        model.fetch(USDT),
        model.fetch(USDT)
      ]);

      expect(token1.id).toBe(token2.id);
    })
  });

  describe('getFloatAmount', () => {
    it('should return readable value', async () => {
      const eth = await model.fetch(WETH);
      const usd = await model.fetch(USDT);

      expect(eth.getFloatAmount(-141165908562470027n), 'Convert BigInt')
        .toBe('-0.141165908562470027'); // 18 decimals

      expect(usd.getFloatAmount(502745000n), 'Respect decimals')
        .toBe('502.745'); // 6 decimals

      expect(eth.getFloatAmount(99999999999999999999999990001n), 'Handle large numbers with precision')
        .toBe('99999999999.999999999999990001');
    })
  })
});

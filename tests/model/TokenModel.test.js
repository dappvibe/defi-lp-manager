describe('TokenModel', () => {
  let tokens, eth, usd;
  let chainId;

  beforeAll(() => {
    chainId = container.resolve('chainId');
    tokens = container.resolve('db').model('Token');
  })

  beforeEach(async() => {
    await tokens.deleteMany({});
    eth = await tokens.create({
      _id: `${chainId}:${WETH}`,
      address: WETH,
      decimals: 18,
      symbol: 'WETH',
      name: 'Wrapped Ether',
    });
    usd = await tokens.create({
      _id: `${chainId}:${USDT}`,
      address: USDT,
      decimals: 6,
      symbol: 'USDT',
      name: 'Tether USD',
    });
  })

  it('fromBlockchain() should fetch token details and return new doc', async () => {
    expect.assertions(7);
    const token = await tokens.fromBlockchain(`${chainId}:${WETH}`);
    expect(token).toBeDefined();
    expect(token.address).toBe(WETH);
    expect(token.decimals).eq(18);
    expect(token.symbol).eq('WETH');
    expect(token.isNew).toBe(true); // unsaved

    // expect throws on unknown token
    await expect(tokens.fromBlockchain(`${chainId}:0x000000000000000000000000000000000000abcd`))
      .rejects.toThrow('returned no data');

    expect(token.contract).toBeDefined();
  })

  it('instances have ERC20 contract', async () => {
    expect.assertions(4);
    let token = await tokens.findById(`${chainId}:${WETH}`);
    expect(token).not.toBeNull();
    expect(token.contract).toBeDefined();

    token = await tokens.findOne({symbol: 'USDT'});
    expect(token.contract).toBeDefined();

    await tokens.deleteOne({_id: `${chainId}:${USDT}`});
    expect(token.contract).toBeDefined();
  })

  it('format() should return human-friendly string', async () => {
    expect.assertions(3);
    expect(eth.format(-141165908562470027n), 'Convert BigInt')
      .toBe('-0.141165908562470027'); // 18 decimals

    expect(usd.format(502745000n), 'Respect decimals')
      .toBe('502.745'); // 6 decimals

    expect(eth.format(99999999999999999999999990001n), 'Handle large numbers with precision')
      .toBe('99999999999.999999999999990001');
  })
});

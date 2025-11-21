describe('TokenModel', () => {
  let db;
  let model;
  let chainId;
  let erc20Factory;

  beforeEach(async() => {
    chainId = container.resolve('chainId');
    erc20Factory = container.resolve('erc20Factory');
    //erc20Factory(WETH).reset(); // reset spyOn() counters
    //erc20Factory(USDT).reset();

    db = container.resolve('db');
    model = db.model('Token');

    await model.deleteMany({});
    await model.create({
      _id: `${chainId}:${WETH}`,
      address: WETH,
      decimals: 18,
      symbol: 'WETH',
      name: 'Wrapped Ether',
    });
    await model.create({
      _id: `${chainId}:${USDT}`,
      address: USDT,
      decimals: 6,
      symbol: 'USDT',
      name: 'Tether USD',
    });
  })

  it('fromBlockchain() should fetch token details and return new doc', async () => {
    const token = await model.fromBlockchain(`${chainId}:${WETH}`);
    expect(token).toBeDefined();
    expect(token.address).toBe(WETH);
    expect(token.decimals).eq(18);
    expect(token.symbol).eq('WETH');
    expect(token.isNew).toBe(true); // unsaved

    // expect throws on unknown token
    await expect(model.fromBlockchain(`${chainId}:0x000000000000000000000000000000000000abcd`))
      .rejects.toThrow('returned no data');
  })

  it('instances have ERC20 contract', async () => {
    let token = await model.findById(`${chainId}:${WETH}`);
    expect(token.contract).toBeDefined();

    token = await model.findOne({symbol: 'USDT'});
    expect(token.contract).toBeDefined();

    await model.deleteOne({_id: `${chainId}:${USDT}`});
    token = await model.create({
      _id: `${chainId}:${USDT}`,
      address: USDT,
      decimals: 6,
      symbol: 'USDT',
      name: 'Tether USD',
    });
    expect(token.contract).toBeDefined();
  })

  it('format() should return human-friendly string', async () => {
    const eth = await model.findById(`${chainId}:${WETH}`);
    const usd = await model.findById(`${chainId}:${USDT}`);

    expect(eth.format(-141165908562470027n), 'Convert BigInt')
      .toBe('-0.141165908562470027'); // 18 decimals

    expect(usd.format(502745000n), 'Respect decimals')
      .toBe('502.745'); // 6 decimals

    expect(eth.format(99999999999999999999999990001n), 'Handle large numbers with precision')
      .toBe('99999999999.999999999999990001');
  })
});

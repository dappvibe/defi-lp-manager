describe('TokenService', () => {
  let container;
  let tokenService;

  beforeAll(async () => {
    await connectTestDB();
  });

  afterAll(async () => {
    await disconnectTestDB();
  });

  beforeEach(async () => {
    await clearTestDB();
    container = createTestContainer();
    tokenService = container.resolve('tokens');
  });

  describe('get', () => {
    it('should fetch token from blockchain and cache in db', async () => {
      const usdtAddress = '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9';

      const token = await tokenService.get(usdtAddress);

      expect(token).toBeDefined();
      expect(token.address.toLowerCase()).toBe(usdtAddress.toLowerCase());
      expect(token.symbol).toBeDefined();
      expect(token.name).toBeDefined();
      expect(token.decimals).toBeDefined();
      expect(token.chainId).toBe(tokenService.chainId);
      expect(token.abi).toBeDefined();
    });

    it('should return cached token on second call', async () => {
      const tokenAddress = '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9';

      const firstCall = await tokenService.get(tokenAddress);
      const secondCall = await tokenService.get(tokenAddress);

      expect(firstCall.symbol).toBe(secondCall.symbol);
      expect(firstCall.name).toBe(secondCall.name);
      expect(firstCall.decimals).toBe(secondCall.decimals);
      expect(firstCall.address).toBe(secondCall.address);
    });

    it('should create token with correct id format', async () => {
      const tokenAddress = '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9';

      await tokenService.get(tokenAddress);

      const tokenModel = container.resolve('tokenModel');
      const expectedId = tokenModel.id(tokenService.chainId, tokenAddress);
      const cachedToken = await tokenModel.findById(expectedId);

      expect(cachedToken).toBeDefined();
      expect(cachedToken._id).toBe(expectedId);
    });

    it('should store blockchain data correctly in database', async () => {
      const tokenAddress = '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9';

      const token = await tokenService.get(tokenAddress);

      const tokenModel = container.resolve('tokenModel');
      const cachedToken = await tokenModel.findById(tokenModel.id(tokenService.chainId, tokenAddress));

      expect(cachedToken.symbol).toBe(token.symbol);
      expect(cachedToken.name).toBe(token.name);
      expect(cachedToken.decimals).toBe(token.decimals);
      expect(cachedToken.chainId).toBe(token.chainId);
      expect(cachedToken.address.toLowerCase()).toBe(token.address.toLowerCase());
    });

    it('should return token with contract abi attached', async () => {
      const tokenAddress = '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9';

      const token = await tokenService.get(tokenAddress);

      expect(token.abi).toBeDefined();
      expect(token.abi.read).toBeDefined();
      expect(typeof token.abi.read.symbol).toBe('function');
      expect(typeof token.abi.read.decimals).toBe('function');
      expect(typeof token.abi.read.name).toBe('function');
    });

    it('should work with different token addresses', async () => {
      const token1Address = '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9';
      const token2Address = '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1';

      const [token1, token2] = await Promise.all([
        tokenService.get(token1Address),
        tokenService.get(token2Address)
      ]);

      expect(token1.address.toLowerCase()).toBe(token1Address.toLowerCase());
      expect(token2.address.toLowerCase()).toBe(token2Address.toLowerCase());
      expect(token1.address).not.toBe(token2.address);
    });
  });
});

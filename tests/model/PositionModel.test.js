describe('PositionModel', () => {
  let model;
  let mockPositionManager;
  let staker;

  beforeEach(() => {
    model = container.resolve('PositionModel');
    mockPositionManager = container.resolve('positionManager');
    mockPositionManager.setupPosition(31337);
    staker = container.resolve('staker');
    staker.setupUserPositionInfo(31337);
  });

  describe('fromBlockchain', () => {
    it('should return position data as map', async () => {
      const doc = await model.fromBlockchain(31337);
      expect(doc).toBeDefined();
      expect(doc.isNew).toBe(true); // unsaved
      expect(doc._id).toBeDefined();
      expect(doc.owner).eq(USER_WALLET);
      expect(doc.pool).toBeDefined();
    });
  });

  describe('fetch', () => {
    it('should create position if not exists', async () => {
      const tokenId = 31337;
      const doc = await model.fetch(tokenId);
      expect(doc.tokenId).toBe(tokenId);
      expect(doc.owner).toBe(USER_WALLET);
      expect(doc.pool).toBeDefined();
      expect(doc.isNew).toBe(false);
      expect(doc._id).toBeDefined();
      expect(doc.positionManager).eq(mockPositionManager.address);
    });
  });

  describe('calculateUnclaimedFees', () => {
    it('should calculate unclaimed fees', async () => {
      const position = await model.fetch(31337);

      const fees = await position.calculateUnclaimedFees();

      expect(fees).toBeDefined();
      expect(fees).not.toBe({});
      expect(fees.token1Fees).eq('0.0002');
      expect(fees.totalValue).eq('0.000200');
    });
  });

  describe('calculateCombinedValue', () => {
    it('should calculate readable tokens total amount', async () => {
      const position = await model.fetch(31337);

      const total = await position.calculateCombinedValue();

      expect(total).toBeDefined();
    });
  });
});

describe('PositionModel', () => {
  let db, model;
  let mockPositionManager;
  let staker;
  let chainId;
  let position, id;

  beforeAll(() => {
    chainId = container.resolve('chainId');
    db = container.resolve('db');
    model = db.model('Position')
    mockPositionManager = container.resolve('positionManager');
    mockPositionManager.setupPosition(31337);
    staker = container.resolve('staker');
    staker.setupUserPositionInfo(31337);
  })

  beforeEach(async () => {
    await model.deleteMany({ chainId });
    id = `${chainId}:0x46A15B0b27311cedF172AB29E4f4766fbE7F4364:31337`;
    position = await model.fromBlockchain(id);
    try {
      position = await position.save();
    } catch (e) {
      if (e.code !== 11000) throw e;
    }
  });

  describe('middleware', () => {
    it('populates tokens even if they not exist in db', async () => {
      await model.deleteMany({});

      const query = {
        _id: `${chainId}:mockManagerAddress:12345`,
        tokenId: 12345,
        owner: 'testOwner',
        pool: `${chainId}:0x17c14d2c404d167802b16c450d3c99f88f2c4f4d`,
        tickLower: -10,
        tickUpper: 10,
        liquidity: BigInt(10000000),
        isStaked: false,
      };

      const check = (position, msg) => {
        expect(position, msg).not.toBeNull();
        expect(position.pool, msg).not.toBeNull();
        expect(position.pool.token0, msg).not.toBeNull();
        expect(position.pool.token1, msg).not.toBeNull();
      };

      await db.model('Pool').deleteMany({});
      let position = await model.create(query);
      check(position, 'create()');

      await db.model('Pool').deleteMany({});
      position = await model.findOne(query);
      check(position, 'findOne()');

      await db.model('Pool').deleteMany({});
      position = await model.findOneAndUpdate(
        { _id: query._id },
        { ...query, liquidity: 999 },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
      check(position, 'findOneAndUpdate()');

      // Find multiple
      await model.create({ ...query, _id: `${chainId}:mockManagerAddress:67890` });
      await db.model('Pool').deleteMany({});
      const positions = await model.find({ isStaked: false });
      expect(positions.length).toBe(2);
      positions.forEach((p) => check(p, 'find() with filter'));

      // Not found
      position = await model.findById('notexist');
      expect(position).toBeNull(); // no exceptions
    });
  })

  describe('fromBlockchain()', () => {
    it('should return unsaved position', async () => {
      const id = `${chainId}:${mockPositionManager.address}:31337`;
      const doc = await model.fromBlockchain(id);
      expect(doc).toBeDefined();
      expect(doc.isNew).toBe(true); // unsaved
      expect(doc._id).toBeDefined();
      expect(doc.owner).eq(USER_WALLET);
      expect(doc.pool).toBeDefined();
    });
  });

  describe('calculateUnclaimedFees()', () => {
    it('should calculate unclaimed fees', async () => {
      const fees = await position.calculateUnclaimedFees();

      expect(fees).toBeDefined();
      expect(fees).not.toBe({});
      expect(fees.token1Fees).eq('0.0002');
      expect(fees.totalValue).eq('0.000200');
    });
  });

  describe('calculateCombinedValue()', () => {
    it('should calculate readable tokens total amount', async () => {
      const total = position.calculateCombinedValue();
      expect(total).toBeDefined();
    });
  });

  describe('calculateTokenAmounts', () => {
    it('should calculate token amounts', async () => {
      const amounts = position.calculateTokenAmounts();
      expect(amounts).toBeDefined();
      expect(amounts[0]).eq('0.0449805');
      expect(amounts[1]).eq('0');
    });
  });

  describe('calculateCakeRewards()', () => {
    it('should calculate cake rewards', async () => {
      const cake = await position.calculateCakeRewards();
      expect(cake).eq('0.000000000314');
    });
  });
});

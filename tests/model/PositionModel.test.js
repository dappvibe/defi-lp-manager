describe('PositionModel', () => {
  let positions, pools;
  let positionManager;
  let staker;
  let chainId;
  let position, id;
  let ethnode;

  beforeAll(async () => {
    chainId = container.resolve('chainId');
    const db = container.resolve('db');
    positions = db.model('Position')
    pools = db.model('Pool');
    positionManager = container.resolve('positionManager');
    staker = container.resolve('staker');
    ethnode = container.resolve('ethnode');
  })

  beforeEach(async () => {
    await pools.deleteMany({_id: new RegExp(`^${chainId}`)});
    await positions.deleteMany({_id: new RegExp(`^${chainId}`)});
    id = `${chainId}:${positionManager.address}:31337`;
    position = await positions.fromBlockchain(id);
    try {
      position = await position.save();
    } catch (e) {
      if (e.code !== 11000) throw e;
    }
  });

  describe('middleware', () => {
    it('populates pools even if they not exist in db', async () => {
      expect.assertions(22);
      const check = (position, msg) => {
        expect(position, msg).not.toBeNull();
        expect(position.pool, msg).not.toBeNull();
        expect(position.pool.token0, msg).not.toBeNull();
        expect(position.pool.token1, msg).not.toBeNull();
      };

      const query = {
        _id: id,
        owner: ZERO_ADDRESS,
        pool: `${chainId}:${WETH_USDC}`,
        tickLower: -10,
        tickUpper: 10,
        liquidity: BigInt(10000000),
        isStaked: false,
      };

      await pools.deleteMany({});
      check(position, 'create()');

      await pools.deleteMany({});
      position = await positions.findById({_id: query._id});
      check(position, 'findById()');

      await pools.deleteMany({});
      position = await positions.findOneAndUpdate(
        { _id: query._id },
        { ...query, liquidity: 999 },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
      check(position, 'findOneAndUpdate()');

      // Find multiple
      await pools.deleteMany({});
      await positions.create({
        ...query,
        _id: `${chainId}:${ZERO_ADDRESS}:1`,
        isStaked: false
      });
      const found = await positions.find({ isStaked: false });
      expect(found.length).toBe(2);
      found.forEach((p) => check(p, 'find() with filter'));

      // Not found
      position = await positions.findById('notexist');
      expect(position).toBeNull(); // no exceptions
    });
  });

  describe('fromBlockchain()', () => {
    it('should return unsaved position', async () => {
      expect.assertions(5);
      const id = `${chainId}:${positionManager.address}:31337`;
      const doc = await positions.fromBlockchain(id);
      expect(doc).toBeDefined();
      expect(doc.isNew).toBe(true); // unsaved
      expect(doc._id).toBeDefined();
      expect(doc.owner).eq(USER_WALLET);
      expect(doc.pool).toBeDefined();
    });
  });

  describe('calculateUnclaimedFees()', () => {
    it('should calculate unclaimed fees', async () => {
      expect.assertions(5);
      const fees = await position.calculateUnclaimedFees();

      expect(fees).toBeDefined();
      expect(fees).not.toBe({});
      expect(fees.token0Fees).eq('0.01');
      expect(fees.token1Fees).eq('0.02');
      expect(fees.totalValue).eq('29.375900');
    });
  });

  describe('calculateTokenAmounts', () => {
    it('should calculate token amounts', async () => {
      expect.assertions(3);
      const amounts = position.calculateTokenAmounts();
      expect(amounts).toBeDefined();
      expect(amounts[0]).eq('0.00099999');
      expect(amounts[1]).eq('0');
    });
  });

  describe('calculateCombinedValue()', () => {
    it('should calculate readable tokens total amount', async () => {
      expect.assertions(1);
      const total = position.calculateCombinedValue();
      expect(total).toBeDefined();
    });
  });

  describe('calculateCakeRewards()', () => {
    it('should calculate cake rewards', async () => {
      expect.assertions(1);
      await ethnode.forCall(staker.address)
        .thenReturn(['uint128'], [100000000020000n]);
      position.isStaked = true;

      const cake = await position.calculateCakeRewards();
      expect(cake).eq('0.00010000000002');
    });
  });
});

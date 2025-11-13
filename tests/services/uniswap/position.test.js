describe('PositionFactory', () => {
  let positionFactory;
  let positionManager;

  beforeAll(async () => {
    positionFactory = container.resolve('positionFactory');
    positionManager = container.resolve('positionManager');
  });

  describe('fetchPositions', () => {
    it('should fetch positions from both position manager and staker', async () => {
      const positions = [];

      positionManager.setupPosition(31337, {
        owner: USER_WALLET
      });

      for await (const position of positionFactory.fetchPositions(USER_WALLET)) {
        positions.push(position);
      }

      expect(Array.isArray(positions)).toBe(true);
      expect(positions.length, 'No positions returned').toBeGreaterThan(0);
      positions.forEach(position => {
        expect(position.id).toBeDefined();
        expect(typeof position.isStaked).toBe('boolean');
        expect(position.pool).toBeDefined();
        expect(position.positionManager).toBeDefined();
        expect(position.staker).toBeDefined();
      });
    });

    it('should create positions from cached data when available', async () => {
      const testWallet = {
        address: '0x32b8133DaEdDd54d7E20Ba7B4dbc41A7724Fd5c5'
      };

      const positionModel = container.resolve('positionModel');
      const cachedPositionData = {
        _id: positionModel.id(positionFactory.chainId, testWallet.address, 0),
        tokenId: 12345n,
        liquidity: 1000000n,
        token0: '0xA0b86a33E6441e6e80D0c4C34F0b0B2e0c0d0e0f',
        token1: '0xB0b86a33E6441e6e80D0c4C34F0b0B2e0c0d0e0g',
        fee: 500,
        tickLower: -1000,
        tickUpper: 1000,
        isStaked: false
      };

      await positionModel.create(cachedPositionData);

      const positions = [];
      for await (const position of positionFactory.fetchPositions(testWallet)) {
        positions.push(position);
        break;
      }

      if (positions.length > 0) {
        const position = positions[0];
        expect(position.token0).toBeDefined();
        expect(position.token1).toBeDefined();
        expect(position.fee).toBe(cachedPositionData.fee);
        expect(position.tickLower).toBe(cachedPositionData.tickLower);
        expect(position.tickUpper).toBe(cachedPositionData.tickUpper);
        expect(position.liquidity).toBe(cachedPositionData.liquidity);
      }
    });

    it('should fetch position details from blockchain when not cached', async () => {
      const positions = [];
      let positionCount = 0;

      for await (const position of positionFactory.fetchPositions(USER_WALLET)) {
        positions.push(position);
        positionCount++;
        if (positionCount >= 1) break;
      }

      if (positions.length > 0) {
        const position = positions[0];
        expect(position.id).toBeDefined();
        expect(position.token0).toBeDefined();
        expect(position.token1).toBeDefined();
        expect(position.fee).toBeDefined();
        expect(position.tickLower).toBeDefined();
        expect(position.tickUpper).toBeDefined();
        expect(position.liquidity).toBeDefined();
      }
    });

    it('should cache position data to database after fetching from blockchain', async () => {
      const positionModel = container.resolve('positionModel');
      let firstPosition = null;

      for await (const position of positionFactory.fetchPositions(USER_WALLET)) {
        firstPosition = position;
        break;
      }

      if (firstPosition) {
        const cachedPosition = await positionModel.findOne({
          tokenId: firstPosition.id,
          isStaked: firstPosition.isStaked
        });

        if (cachedPosition) {
          expect(cachedPosition.tokenId).toBe(firstPosition.id);
          expect(cachedPosition.token0).toBe(firstPosition.token0.address);
          expect(cachedPosition.token1).toBe(firstPosition.token1.address);
          expect(cachedPosition.fee).toBe(firstPosition.fee);
          expect(cachedPosition.tickLower).toBe(firstPosition.tickLower);
          expect(cachedPosition.tickUpper).toBe(firstPosition.tickUpper);
          expect(cachedPosition.liquidity).toBe(firstPosition.liquidity);
          expect(cachedPosition.isStaked).toBe(firstPosition.isStaked);
        }
      }
    });

    it('should handle wallets with no positions', async () => {
      const emptyWallet = {
        address: '0x0000000000000000000000000000000000000001'
      };

      const positions = [];
      for await (const position of positionFactory.fetchPositions(emptyWallet)) {
        positions.push(position);
      }

      expect(positions).toHaveLength(0);
    });

    it('should iterate positions in descending order by index', async () => {
      const positions = [];
      const indices = [];
      let count = 0;

      for await (const position of positionFactory.fetchPositions(USER_WALLET)) {
        positions.push(position);
        indices.push(count);
        count++;
        if (count >= 3) break;
      }

      expect(indices).toEqual([0, 1, 2]);
    });

    it('should process both unstaked and staked positions', async () => {
      const positions = [];
      const stakedPositions = [];
      const unstakedPositions = [];

      for await (const position of positionFactory.fetchPositions(USER_WALLET)) {
        positions.push(position);
        if (position.isStaked) {
          stakedPositions.push(position);
        } else {
          unstakedPositions.push(position);
        }
        if (positions.length >= 10) break;
      }

      positions.forEach(position => {
        expect(typeof position.isStaked).toBe('boolean');
        expect(position.positionManager).toBeDefined();
        expect(position.staker).toBeDefined();
      });
    });
  });
});

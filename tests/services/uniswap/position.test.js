describe('PositionFactory', () => {
  let positionFactory, positionManager, staker;
  let ethnode;
  let positions;

  beforeAll(async () => {
    positionFactory = container.resolve('positionFactory');
    positionManager = container.resolve('positionManager');
    staker = container.resolve('staker');
    ethnode = container.resolve('ethnode');
    positions = container.resolve('db').model('Position');
  });

  beforeEach(async () => {
    await positions.deleteMany({});
  })

  describe('fetchPositions', () => {
    it('should fetch positions from both position manager and staker', async () => {
      await ethnode.forCall(positionManager.address)
        .forFunction('function balanceOf(address account) external view returns (uint256)')
        .withParams([USER_WALLET])
        .thenReturn([0]);
      await ethnode.forCall(staker.address)
        .forFunction('function balanceOf(address account) external view returns (uint256)')
        .withParams([USER_WALLET])
        .thenReturn([1]);
      await ethnode.forCall(staker.address)
        .forFunction('function tokenOfOwnerByIndex(address owner, uint256 index) external view returns (uint256)')
        .thenReturn([31337n]);

      const positions = [];

      for await (const position of positionFactory.fetchPositions(USER_WALLET)) {
        positions.push(position);
      }

      expect(Array.isArray(positions)).toBe(true);
      expect(positions.length, 'No positions returned').toBeGreaterThan(0);
      positions.forEach(position => {
        expect(position.id).toBeDefined();
        expect(typeof position.isStaked).toBe('boolean');
        expect(position.pool).toBeDefined();
      });
    });
  });
});

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
      expect.assertions(5);
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

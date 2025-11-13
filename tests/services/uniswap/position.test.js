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
  });
});

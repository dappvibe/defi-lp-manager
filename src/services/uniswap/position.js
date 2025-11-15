const awilix = require("awilix");

/**
 * Position Factory can list staked and unstaked liquidity for a wallet.
 * It will query NonfungiblePositionManager AND MasterChefV3 staking contract for the wallet's positions.
 * It caches static results to the DB so that each wallet is only queried once.
 * Then it will build Position objects with dependencies injected.
 * Position objects are then used to query current liquidity. Attached Pool provides prices.
 *
 * It is abstraction to hide contracts routing, caching and DI for access to liquidity of an address.
 */
class PositionFactory
{
  constructor(staker, PositionModel, positionManager, chainId) {
    this.staker = staker;
    this.positionModel = PositionModel;
    this.positionManager = positionManager;
    this.chainId = chainId;
  }

  /**
  * Query both NonfungiblePositionManager and Staker contracts for `address` positions.
  *
  * @param address
  * @returns {Promise<Generator>}
  */
  async *fetchPositions(address)
  {
    const iterateContract = async function* (contract, isStaked) {
      const count = await contract.read.balanceOf([address]);

      // This must be sequential, not Promise.all to not hit Alchemy (free-tier) rate limits
      for (let i = Number(count) - 1; i >= 0; i--) {
        const tokenId = await contract.read.tokenOfOwnerByIndex([address, i]);
        const pos = await this.positionModel.fetch(Number(tokenId));

        if (pos.isStaked !== isStaked) {
          pos.isStaked = isStaked;
          pos.save(); // nowait
        }
        yield pos;
      }
    };

    yield* iterateContract.call(this, this.staker, true);
    yield* iterateContract.call(this, this.positionManager, false);
  }
}

module.exports = (container) => {
  container.register({
    positionFactory: awilix.asClass(PositionFactory).singleton()
  })
};

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
  constructor(poolFactory, pools, tokens, staker, tokenModel, positionModel, positionManager, chainId, poolModel) {
    this.poolFactory = poolFactory;
    this.pools = pools;
    this.tokens = tokens;
    this.staker = staker;
    this.tokenModel = tokenModel;
    this.positionModel = positionModel;
    this.positionManager = positionManager;
    this.chainId = chainId;
    this.poolModel = poolModel;
  }

  async *fetchPositions(wallet)
  {
    const iterateContract = async function* (contract, isStaked) {
      const count = await contract.read.balanceOf([wallet.address]);

      let doc = null;
      // This must be sequential, not Promise.all to not hit Alchemy (free-tier) rate limits
      for (let i = Number(count) - 1; i >= 0; i--) {
        let position = null;
        const _id = this.positionModel.id(this.chainId, wallet.address, i);
        doc = await this.positionModel.findById(_id);
        if (!doc) {
          const tokenId = await contract.read.tokenOfOwnerByIndex([wallet.address, i]);

          doc = this.positionModel.findOrCreate(this.chainId, tokenId, i);

          position = new Position(isStaked, this.chainId, tokenId, this.pools, this.tokens, this.positionManager, this.staker);
          await position.fetchDetails();

          const pool = await this.poolFactory.getPool(position.token0.address, position.token1.address, position.fee);

          doc = await this.positionModel.create({
            _id,
            tokenId: Number(position.id),
            liquidity: position.liquidity,
            pool: this.poolModel.id(this.chainId, pool.address),
            tickLower: position.tickLower,
            tickUpper: position.tickUpper,
            isStaked: position.isStaked,
          });
        }

        await doc.populate('pool');

        yield doc;
      }
    };

    yield* iterateContract.call(this, this.positionManager, false);
    yield* iterateContract.call(this, this.staker, true);
  }
}

module.exports = (container) => {
  container.register({
    positionFactory: awilix.asClass(PositionFactory).singleton()
  })
};

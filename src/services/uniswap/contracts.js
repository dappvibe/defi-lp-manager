/**
 * Contract interaction service
 * Handles creation and interaction with Ethereum contracts
 */
const awilix = require('awilix');
const { getContract } = require('viem');

// Contract addresses for PancakeSwap on Arbitrum
const CONTRACT_ADDRESSES = {
  pancakeswap: {
    arbitrum: {
      nonfungiblePositionManager: '0x46a15b0b27311cedf172ab29e4f4766fbe7f4364',
      masterChefV3: '0x5e09acf80c0296740ec5d6f643005a4ef8daa694',
      V3Factory: '0x0bfbcf9fa4f9c56b0f40a671ad40e0805a091865'
    }
  }
};

module.exports = (container) => {
  const addresses = CONTRACT_ADDRESSES.pancakeswap.arbitrum;

  container.register({
    chainId: awilix.asValue(42161), // TODO: query each time when used so changes are reflected
    positionManager: awilix.asFunction((provider) => {
      return getContract({
        address: addresses.nonfungiblePositionManager,
        abi: require('./abis/v3-position-manager.json'),
        client: provider
      })
    }).singleton(),
    staker: awilix.asFunction((provider) => {
      return getContract({
        address: addresses.masterChefV3,
        abi: require('./abis/masterchef-v3.json'),
        client: provider
      })
    }).singleton(),
    erc20Factory: awilix.asValue((address) => {
      return getContract({
        address: address,
        abi: require('./abis/erc20.json'),
        client: container.resolve('provider')
      });
    }),
    poolFactoryContract: awilix.asFunction((provider) => {
      return getContract({
        address: addresses.V3Factory,
        abi: require('./abis/v3-factory.json'),
        client: provider
      })
    }),
    poolContract: awilix.asValue((address) => {
      return getContract({
        address: address,
        abi: require('./abis/v3-pool.json'),
        client: container.resolve('provider')
      });
    }),
    // can't use db.model() here because PositionModel depends on cakePool
    cakePool: awilix.asFunction((PoolModel, chainId) => {
      if (chainId !== 42161) throw new Error('Cake pool is only available on Arbitrum');
      const id = `${chainId}:0xdaa5b2e06ca117f25c8d62f7f7fbaedcf7a939f4`;
      return PoolModel.findById(id).then(pool => {
        return pool ? pool : PoolModel.fromBlockchain(id).then(pool => pool?.save());
      });
    }).singleton()
  })
};

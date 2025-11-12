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
      nonfungiblePositionManager: '0x46A15B0b27311cedF172AB29E4f4766fbE7F4364',
      masterChefV3: '0x5e09acf80c0296740ec5d6f643005a4ef8daa694',
      V3Factory: '0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865'
    }
  }
};

module.exports = (container) => {
  const provider = container.resolve('provider');
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
        client: provider
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
        client: provider
      });
    })
  })
};

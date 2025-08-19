/**
 * Pre-configured pools configuration
 * Pool addresses as a list with details as comments
 */

class PoolsConfig {
  constructor() {
    this.pancakeswap = {
      arbitrum: [
        // USDC/WETH (0.01% fee)
        '0x7fcdc35463e3770c2fb992716cd070b63540b947',
        // USDC/WETH (0.05% fee)
        '0xd9e2a1a61b6e61b275cec326465d417e52c1b95c',
        // USDT/WETH (0.01% fee)
        '0x389938cf14be379217570d8e4619e51fbdafaa21',
        // USDC/WBTC (0.05% fee)
        '0x843ac8dc6d34aeb07a56812b8b36429ee46bdd07',
        // USDT/WETH (0.05% fee)
        '0x0bacc7a9717e70ea0da5ac075889bd87d4c81197',
        // USDC/WBTC (0.01% fee)
        '0x5a17cbf5f866bde11c28861a2742764fac0eba4b',
        // USDC/ARB (0.05% fee)
        '0x9ffca51d23ac7f7df82da414865ef1055e5afcc3',
        // USDT/LINK (0.05% fee)
        '0x2d0bb2f6d514118642f8588b1c22043e865eaa88',
        // CAKE/USDC (0.25% fee)
        '0xdaa5b2e06ca117f25c8d62f7f7fbaedcf7a939f4'
      ]
    };

  }

  /**
   * Get all available platforms
   * @returns {string[]} Array of platform names
   */
  getAvailablePlatforms() {
    return Object.keys(this);
  }

  /**
   * Get all available blockchains for a specific platform
   * @param {string} platform - Platform name
   * @returns {string[]} Array of blockchain names
   */
  getAvailableBlockchains(platform) {
    const platformPools = this[platform];
    if (!platformPools) {
      throw new Error(`Unsupported platform: ${platform}`);
    }
    return Object.keys(platformPools);
  }

  /**
   * Get pools for a specific platform and blockchain
   * @param {string} platform - Platform name
   * @param {string} blockchain - Blockchain name
   * @returns {Array} Array of pool addresses
   */
  getPools(platform, blockchain) {
    const platformPools = this[platform];
    if (!platformPools) {
      throw new Error(`Unsupported platform: ${platform}`);
    }

    const blockchainPools = platformPools[blockchain];
    if (!blockchainPools) {
      throw new Error(`Unsupported blockchain: ${blockchain} for platform: ${platform}`);
    }

    return blockchainPools;
  }

  /**
   * Get all enabled pre-configured pools (flattened from all platforms/blockchains)
   * @returns {Array} Array of pool addresses with platform/blockchain info
   */
  getEnabledPools() {
    const enabledPools = [];

    for (const [platform, blockchains] of Object.entries(this)) {
      // Skip methods and other non-data properties
      if (typeof blockchains !== 'object' || Array.isArray(blockchains) || blockchains === null) {
        continue;
      }

      for (const [blockchain, pools] of Object.entries(blockchains)) {
        for (const address of pools) {
          enabledPools.push({
            address,
            platform,
            blockchain
          });
        }
      }
    }

    return enabledPools;
  }

  /**
   * Get pool configuration by address (searches across all platforms/blockchains)
   * @param {string} address - Pool address
   * @returns {Object|null} Pool configuration with platform/blockchain info or null if not found
   */
  getPoolByAddress(address) {
    for (const [platform, blockchains] of Object.entries(this)) {
      // Skip methods and other non-data properties
      if (typeof blockchains !== 'object' || Array.isArray(blockchains) || blockchains === null) {
        continue;
      }

      for (const [blockchain, pools] of Object.entries(blockchains)) {
        const poolAddress = pools.find(p =>
            p.toLowerCase() === address.toLowerCase()
        );
        if (poolAddress) {
          return {
            address: poolAddress,
            platform,
            blockchain
          };
        }
      }
    }
    return null;
  }

  /**
   * Check if a pool is pre-configured
   * @param {string} address - Pool address
   * @returns {boolean} True if pool is pre-configured
   */
  isPreConfigured(address) {
    return this.getPoolByAddress(address) !== null;
  }

  /**
   * Get enabled pools for a specific platform
   * @param {string} platform - Platform name
   * @returns {Array} Array of pool addresses with platform/blockchain info
   */
  getEnabledPoolsByPlatform(platform) {
    const platformPools = this[platform];
    if (!platformPools) {
      return [];
    }

    const enabledPools = [];
    for (const [blockchain, pools] of Object.entries(platformPools)) {
      for (const address of pools) {
        enabledPools.push({
          address,
          platform,
          blockchain
        });
      }
    }

    return enabledPools;
  }
}

module.exports = PoolsConfig;

/**
 * Pre-configured pools configuration
 * Pool addresses as a list with details as comments
 */

class PoolsConfig {
  constructor() {
    this.pancakeswap = {
      arbitrum: [
        // USDC/WETH (0.01% fee)
        '0x7fCDC35463E3770c2fB992716Cd070B63540b947',
        // USDC/WETH (0.05% fee)
        '0xd9e2a1a61B6E61b275cEc326465d417e52C1b95c',
        // USDT/WETH (0.01% fee)
        '0x389938CF14Be379217570D8e4619E51fBDafaa21',
        // USDC/WBTC (0.05% fee)
        '0x843aC8dc6D34AEB07a56812b8b36429eE46BDd07',
        // USDT/WETH (0.05% fee)
        '0x0BaCc7a9717e70EA0DA5Ac075889Bd87d4C81197',
        // USDC/WBTC (0.01% fee)
        '0x5A17cbf5F866BDe11C28861a2742764Fac0Eba4B',
        // USDC/ARB (0.05% fee)
        '0x9fFCA51D23Ac7F7df82da414865Ef1055E5aFCc3',
        // USDT/LINK (0.05% fee)
        '0x2d0Bb2f6D514118642f8588B1c22043e865EaA88'
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

// Create and export a singleton instance
const poolsConfig = new PoolsConfig();
module.exports = poolsConfig;

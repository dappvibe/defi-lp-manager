/**
 * Pre-configured pools configuration
 * Structure: platform -> blockchain -> pools
 * Contains pools organized by platform (PancakeSwap, Uniswap, etc.) and blockchain (Arbitrum, Ethereum, etc.)
 */

const poolsConfig = {
  uniswap: {
    arbitrum: [
      {
        address: '0xC31E54c7a869B9FcBEcc14363CF510d1c41fa443',
        name: 'ETH/USDC',
        description: 'Ethereum / USD Coin (0.05% fee)',
        fee: '0.05%',
        enabled: true,
        priceMonitoringEnabled: false, // Price monitoring disabled by default
      },
      {
        address: '0x17c14D2c404D167802b16C450d3c99F88F2c4F4d',
        name: 'ETH/USDC',
        description: 'Ethereum / USD Coin (0.3% fee)',
        fee: '0.3%',
        enabled: true,
        priceMonitoringEnabled: false,
      },
      {
        address: '0x641C00A822e8b671738d32a431a4Fb6074E5c79d',
        name: 'ETH/USDT',
        description: 'Ethereum / Tether USD (0.3% fee)',
        fee: '0.3%',
        enabled: true,
        priceMonitoringEnabled: false,
      }
    ],
    ethereum: [
      {
        address: '0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640',
        name: 'ETH/USDC',
        description: 'Ethereum / USD Coin (0.05% fee)',
        fee: '0.05%',
        enabled: true,
        priceMonitoringEnabled: false,
      }
    ]
  },
  pancakeswap: {
    arbitrum: [
      {
        address: '0x6a9146bc52c2d54a2e8a5c0e8b7d6b8b6c8e8f8a', // Example - replace with actual PancakeSwap pool
        name: 'ARB/ETH',
        description: 'Arbitrum / Ethereum (0.3% fee)',
        fee: '0.3%',
        enabled: false, // Disabled until valid address is provided
        priceMonitoringEnabled: false,
      }
    ],
    bsc: [
      {
        address: '0x7a9146bc52c2d54a2e8a5c0e8b7d6b8b6c8e8f8b', // Example - replace with actual BSC pool
        name: 'BNB/USDT',
        description: 'Binance Coin / Tether USD (0.25% fee)',
        fee: '0.25%',
        enabled: false, // Disabled until valid address is provided
        priceMonitoringEnabled: false,
      }
    ]
  }
};

module.exports = {
  poolsConfig,

  /**
   * Get all available platforms
   * @returns {string[]} Array of platform names
   */
  getAvailablePlatforms() {
    return Object.keys(poolsConfig);
  },

  /**
   * Get all available blockchains for a specific platform
   * @param {string} platform - Platform name
   * @returns {string[]} Array of blockchain names
   */
  getAvailableBlockchains(platform) {
    const platformPools = poolsConfig[platform];
    if (!platformPools) {
      throw new Error(`Unsupported platform: ${platform}`);
    }
    return Object.keys(platformPools);
  },

  /**
   * Get pools for a specific platform and blockchain
   * @param {string} platform - Platform name
   * @param {string} blockchain - Blockchain name
   * @returns {Array} Array of pool configurations
   */
  getPools(platform, blockchain) {
    const platformPools = poolsConfig[platform];
    if (!platformPools) {
      throw new Error(`Unsupported platform: ${platform}`);
    }

    const blockchainPools = platformPools[blockchain];
    if (!blockchainPools) {
      throw new Error(`Unsupported blockchain: ${blockchain} for platform: ${platform}`);
    }

    return blockchainPools;
  },

  /**
   * Get all enabled pre-configured pools (flattened from all platforms/blockchains)
   * @returns {Array} Array of enabled pool configurations with platform/blockchain info
   */
  getEnabledPools() {
    const enabledPools = [];

    for (const [platform, blockchains] of Object.entries(poolsConfig)) {
      for (const [blockchain, pools] of Object.entries(blockchains)) {
        for (const pool of pools) {
          if (pool.enabled) {
            enabledPools.push({
              ...pool,
              platform,
              blockchain
            });
          }
        }
      }
    }

    return enabledPools;
  },

  /**
   * Get pool configuration by address (searches across all platforms/blockchains)
   * @param {string} address - Pool address
   * @returns {Object|null} Pool configuration with platform/blockchain info or null if not found
   */
  getPoolByAddress(address) {
    for (const [platform, blockchains] of Object.entries(poolsConfig)) {
      for (const [blockchain, pools] of Object.entries(blockchains)) {
        const pool = pools.find(p =>
          p.address.toLowerCase() === address.toLowerCase()
        );
        if (pool) {
          return {
            ...pool,
            platform,
            blockchain
          };
        }
      }
    }
    return null;
  },

  /**
   * Check if a pool is pre-configured
   * @param {string} address - Pool address
   * @returns {boolean} True if pool is pre-configured
   */
  isPreConfigured(address) {
    return this.getPoolByAddress(address) !== null;
  },

  /**
   * Get enabled pools for a specific platform
   * @param {string} platform - Platform name
   * @returns {Array} Array of enabled pool configurations for the platform
   */
  getEnabledPoolsByPlatform(platform) {
    const platformPools = poolsConfig[platform];
    if (!platformPools) {
      return [];
    }

    const enabledPools = [];
    for (const [blockchain, pools] of Object.entries(platformPools)) {
      for (const pool of pools) {
        if (pool.enabled) {
          enabledPools.push({
            ...pool,
            platform,
            blockchain
          });
        }
      }
    }

    return enabledPools;
  },

  /**
   * Get enabled pools for a specific platform and blockchain
   * @param {string} platform - Platform name
   * @param {string} blockchain - Blockchain name
   * @returns {Array} Array of enabled pool configurations
   */
  getEnabledPoolsByPlatformAndBlockchain(platform, blockchain) {
    try {
      const pools = this.getPools(platform, blockchain);
      return pools.filter(pool => pool.enabled).map(pool => ({
        ...pool,
        platform,
        blockchain
      }));
    } catch (error) {
      return [];
    }
  }
};

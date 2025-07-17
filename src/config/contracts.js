/**
 * Contract addresses organized by platform, network, and contract type
 * Structure: platform -> network -> contract -> address
 */

const contracts = {
    pancakeswap: {
        arbitrum: {
            nonfungiblePositionManager: '0x46A15B0b27311cedF172AB29E4f4766fbE7F4364',
            masterChefV3: '0x5e09acf80c0296740ec5d6f643005a4ef8daa694',
            V3Factory: '0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865'
        },
    },
};

/**
 * Get contract address for a specific platform, network, and contract type
 * @param {string} platform - Platform name (pancakeswap, uniswap, sushiswap)
 * @param {string} network - Network name (ethereum, arbitrum, bsc, polygon)
 * @param {string} contractType - Contract type (nonfungiblePositionManager, factory, etc.)
 * @returns {string} Contract address
 * @throws {Error} If platform, network, or contract type not found
 */
function getContractAddress(platform, network, contractType) {
    const platformContracts = contracts[platform];
    if (!platformContracts) {
        throw new Error(`Unsupported platform: ${platform}`);
    }

    const networkContracts = platformContracts[network];
    if (!networkContracts) {
        throw new Error(`Unsupported network: ${network} for platform: ${platform}`);
    }

    const contractAddress = networkContracts[contractType];
    if (!contractAddress) {
        throw new Error(`Contract ${contractType} not found for ${platform} on ${network}`);
    }

    return contractAddress;
}

/**
 * Get all available platforms
 * @returns {string[]} Array of platform names
 */
function getAvailablePlatforms() {
    return Object.keys(contracts);
}

/**
 * Get all available networks for a specific platform
 * @param {string} platform - Platform name
 * @returns {string[]} Array of network names
 */
function getAvailableNetworks(platform) {
    const platformContracts = contracts[platform];
    if (!platformContracts) {
        throw new Error(`Unsupported platform: ${platform}`);
    }
    return Object.keys(platformContracts);
}

/**
 * Get all available contract types for a specific platform and network
 * @param {string} platform - Platform name
 * @param {string} network - Network name
 * @returns {string[]} Array of contract type names
 */
function getAvailableContracts(platform, network) {
    const platformContracts = contracts[platform];
    if (!platformContracts) {
        throw new Error(`Unsupported platform: ${platform}`);
    }

    const networkContracts = platformContracts[network];
    if (!networkContracts) {
        throw new Error(`Unsupported network: ${network} for platform: ${platform}`);
    }

    return Object.keys(networkContracts);
}

module.exports = {
    contracts,
    getContractAddress,
    getAvailablePlatforms,
    getAvailableNetworks,
    getAvailableContracts,
};

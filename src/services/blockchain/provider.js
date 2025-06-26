/**
 * Blockchain provider service
 * Manages connections to Ethereum nodes
 */
const { ethers } = require('ethers');
const config = require('../../config/environment');

/**
 * Create a provider instance for interacting with the blockchain
 * @returns {ethers.providers.Provider} The provider instance
 */
function createProvider() {
    return new ethers.providers.AlchemyProvider(
        config.blockchain.network,
        config.blockchain.alchemyApiKey
    );
}

// Singleton provider instance
let providerInstance = null;

/**
 * Get the provider instance (creates it if it doesn't exist)
 * @returns {ethers.providers.Provider} The provider instance
 */
function getProvider() {
    if (!providerInstance) {
        providerInstance = createProvider();
    }
    return providerInstance;
}

module.exports = {
    getProvider,
    createProvider, // Exported for testing
};

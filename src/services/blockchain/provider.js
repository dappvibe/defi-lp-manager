/**
 * Blockchain provider service
 * Manages connections to Ethereum nodes
 */
const { createPublicClient, http } = require('viem');
const { mainnet, sepolia, polygon, arbitrum } = require('viem/chains');
const config = require('../../config/environment');

/**
 * Map network names to viem chains
 */
const CHAIN_MAP = {
    'mainnet': mainnet,
    'sepolia': sepolia,
    'polygon': polygon,
    'arbitrum': arbitrum
};

/**
 * Create a provider instance for interacting with the blockchain
 * @returns {PublicClient} The viem client instance
 */
function createProvider() {
    const chain = CHAIN_MAP[config.blockchain.network] || mainnet;
    const alchemyUrl = `https://${config.blockchain.network}.g.alchemy.com/v2/${config.blockchain.alchemyApiKey}`;

    return createPublicClient({
        chain,
        transport: http(alchemyUrl)
    });
}

// Singleton provider instance
let providerInstance = null;

/**
 * Get the provider instance (creates it if it doesn't exist)
 * @returns {PublicClient} The viem client instance
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

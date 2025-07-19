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
 * Map network names to Alchemy URLs
 */
const ALCHEMY_URL_MAP = {
    'mainnet': 'eth-mainnet.g.alchemy.com',
    'sepolia': 'eth-sepolia.g.alchemy.com',
    'polygon': 'polygon-mainnet.g.alchemy.com',
    'arbitrum': 'arb-mainnet.g.alchemy.com'
};

/**
 * Create a provider instance for interacting with the blockchain
 */
function createProvider() {
    const chain = CHAIN_MAP[config.blockchain.network] || mainnet;
    const alchemyHost = ALCHEMY_URL_MAP[config.blockchain.network] || 'eth-mainnet.g.alchemy.com';
    const alchemyUrl = `https://${alchemyHost}/v2/${config.blockchain.alchemyApiKey}`;

    return createPublicClient({
        chain,
        transport: http(alchemyUrl)
    });
}

// Singleton provider instance
let providerInstance = null;

/**
 * Get the provider instance (creates it if it doesn't exist)
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

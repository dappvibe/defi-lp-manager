/**
 * Blockchain provider service
 * Manages WebSocket connections to Ethereum nodes
 */
const { createPublicClient, webSocket } = require('viem');
const { mainnet, sepolia, polygon, arbitrum } = require('viem/chains');
const config = require('../../config/config');

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
 * Map network names to Alchemy WebSocket URLs
 */
const ALCHEMY_URL_MAP = {
  'mainnet': 'eth-mainnet.g.alchemy.com',
  'sepolia': 'eth-sepolia.g.alchemy.com',
  'polygon': 'polygon-mainnet.g.alchemy.com',
  'arbitrum': 'arb-mainnet.g.alchemy.com'
};

/**
 * Create a WebSocket provider instance for real-time blockchain data
 */
function createProvider() {
  const chain = CHAIN_MAP[config.blockchain.network] || mainnet;
  const alchemyHost = ALCHEMY_URL_MAP[config.blockchain.network];
  const alchemyWsUrl = `wss://${alchemyHost}/v2/${config.blockchain.alchemyApiKey}`;

  return createPublicClient({
    chain,
    transport: webSocket(alchemyWsUrl, {
      reconnect: {
        attempts: 5,
        delay: 1000
      },
      timeout: 30000,
      keepAlive: {
        interval: 30000,
        pongTimeout: 5000
      }
    })
  });
}

module.exports = createProvider;

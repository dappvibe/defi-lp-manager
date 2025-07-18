const { Token } = require('@uniswap/sdk-core');
const { getContract } = require('viem');
const { mongo } = require('../database/mongo');

class TokenService {
    constructor(provider) {
        this.provider = provider;
        this.tokenCache = new Map(); // Keep in-memory cache for performance
        this.erc20Abi = require('./abis/erc20.json');
        this.mongo = mongo;
    }

    /**
     * Create a contract instance for a token
     * @param {string} address - Token address
     * @returns {Object} Contract instance
     */
    createTokenContract(address) {
        return getContract({
            address,
            abi: this.erc20Abi,
            client: this.provider
        });
    }

    /**
     * Add contract property to token
     * @param {Token} token - Token instance
     * @returns {Token} Token with contract property
     */
    addContractToToken(token) {
        if (!token.contract) {
            token.contract = this.createTokenContract(token.address);
        }
        return token;
    }

    async getToken(address, chainId = 42161) {
        const cacheKey = `${address}-${chainId}`;

        // Check in-memory cache first for best performance
        if (this.tokenCache.has(cacheKey)) {
            const cachedToken = this.tokenCache.get(cacheKey);
            return this.addContractToToken(cachedToken);
        }

        // Check MongoDB cache
        const cachedToken = await this.getCachedTokenFromMongo(address, chainId);
        if (cachedToken) {
            // Add contract property to cached token
            const tokenWithContract = this.addContractToToken(cachedToken);
            // Store in memory cache for faster subsequent access
            this.tokenCache.set(cacheKey, tokenWithContract);
            return tokenWithContract;
        }

        try {
            const tokenContract = this.createTokenContract(address);

            const [symbol, decimals, name] = await Promise.all([
                tokenContract.read.symbol(),
                tokenContract.read.decimals(),
                tokenContract.read.name()
            ]);

            const token = new Token(chainId, address, decimals, symbol, name);
            // Add contract property to the token
            token.contract = tokenContract;

            // Cache in both memory and MongoDB
            this.tokenCache.set(cacheKey, token);
            await this.cacheTokenInMongo(address, chainId, { symbol, decimals, name });

            return token;
        } catch (error) {
            console.error(`Error creating token for ${address}:`, error);
            // Return fallback token
            const fallbackToken = new Token(chainId, address, 18, 'UNKNOWN', 'Unknown Token');
            // Add contract property to fallback token
            fallbackToken.contract = this.createTokenContract(address);

            // Cache fallback token as well to avoid repeated failures
            this.tokenCache.set(cacheKey, fallbackToken);
            await this.cacheTokenInMongo(address, chainId, {
                symbol: 'UNKNOWN',
                decimals: 18,
                name: 'Unknown Token'
            });

            return fallbackToken;
        }
    }

    /**
     * Get cached token from MongoDB
     * @param {string} address - Token address
     * @param {number} chainId - Chain ID
     * @returns {Token|null} Cached token or null if not found
     */
    async getCachedTokenFromMongo(address, chainId) {
        try {
            if (!this.mongo.isConnected) {
                await this.mongo.connect();
            }

            const tokenData = await this.mongo.db.collection('tokens').findOne({
                address: address.toLowerCase(),
                chainId
            });

            if (tokenData) {
                return new Token(
                    chainId,
                    address,
                    tokenData.decimals,
                    tokenData.symbol,
                    tokenData.name
                );
            }

            return null;
        } catch (error) {
            console.error(`Error getting cached token from MongoDB for ${address}:`, error);
            return null;
        }
    }

    /**
     * Cache token in MongoDB
     * @param {string} address - Token address
     * @param {number} chainId - Chain ID
     * @param {Object} tokenData - Token data to cache
     */
    async cacheTokenInMongo(address, chainId, tokenData) {
        try {
            if (!this.mongo.isConnected) {
                await this.mongo.connect();
            }

            const tokenDoc = {
                address: address.toLowerCase(),
                chainId,
                symbol: tokenData.symbol,
                decimals: tokenData.decimals,
                name: tokenData.name,
                cachedAt: new Date(),
                updatedAt: new Date()
            };

            await this.mongo.db.collection('tokens').replaceOne(
                { address: address.toLowerCase(), chainId },
                tokenDoc,
                { upsert: true }
            );

            console.log(`Cached token ${tokenData.symbol} (${address}) in MongoDB`);
        } catch (error) {
            console.error(`Error caching token in MongoDB for ${address}:`, error);
        }
    }

    /**
     * Clear all caches (both memory and MongoDB)
     */
    async clearCache() {
        this.tokenCache.clear();

        try {
            if (!this.mongo.isConnected) {
                await this.mongo.connect();
            }

            await this.mongo.db.collection('tokens').deleteMany({});
            console.log('Cleared all token caches');
        } catch (error) {
            console.error('Error clearing token cache from MongoDB:', error);
        }
    }

    /**
     * Clear cache for specific token
     * @param {string} address - Token address
     * @param {number} chainId - Chain ID
     */
    async clearTokenCache(address, chainId) {
        const cacheKey = `${address}-${chainId}`;
        this.tokenCache.delete(cacheKey);

        try {
            if (!this.mongo.isConnected) {
                await this.mongo.connect();
            }

            await this.mongo.db.collection('tokens').deleteOne({
                address: address.toLowerCase(),
                chainId
            });

            console.log(`Cleared cache for token ${address} on chain ${chainId}`);
        } catch (error) {
            console.error(`Error clearing token cache from MongoDB for ${address}:`, error);
        }
    }

    /**
     * Get all cached tokens from MongoDB
     * @returns {Array} Array of cached tokens
     */
    async getAllCachedTokens() {
        try {
            if (!this.mongo.isConnected) {
                await this.mongo.connect();
            }

            const tokens = await this.mongo.db.collection('tokens').find({}).toArray();
            return tokens;
        } catch (error) {
            console.error('Error getting all cached tokens from MongoDB:', error);
            return [];
        }
    }

    /**
     * Create database indexes for efficient token queries
     */
    async createTokenIndexes() {
        try {
            if (!this.mongo.isConnected) {
                await this.mongo.connect();
            }

            const tokensCollection = this.mongo.db.collection('tokens');

            // Create indexes for efficient queries
            await tokensCollection.createIndex({ address: 1, chainId: 1 }, { unique: true });
            await tokensCollection.createIndex({ symbol: 1 });
            await tokensCollection.createIndex({ chainId: 1 });
            await tokensCollection.createIndex({ cachedAt: 1 });

            console.log('Created token collection indexes');
        } catch (error) {
            console.error('Error creating token indexes:', error);
        }
    }
}

module.exports = TokenService;

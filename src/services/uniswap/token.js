const { Token } = require('@uniswap/sdk-core');
const { getContract } = require('viem');
const { mongoose } = require('../database/mongoose');

class TokenService {
    constructor(provider) {
        this.provider = provider;
        this.tokenCache = new Map(); // Keep in-memory cache for performance
        this.erc20Abi = require('./abis/erc20.json');
        this.mongoose = mongoose;
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
        const cachedToken = await this.getCachedTokenFromMongoose(address, chainId);
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
            await this.cacheTokenInMongoose(address, chainId, { symbol, decimals, name });

            return token;
        } catch (error) {
            console.error(`Error creating token for ${address}:`, error);
            // Return fallback token
            const fallbackToken = new Token(chainId, address, 18, 'UNKNOWN', 'Unknown Token');
            // Add contract property to fallback token
            fallbackToken.contract = this.createTokenContract(address);

            // Cache fallback token as well to avoid repeated failures
            this.tokenCache.set(cacheKey, fallbackToken);
            await this.cacheTokenInMongoose(address, chainId, {
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
    async getCachedTokenFromMongoose(address, chainId) {
        try {
            const tokenData = await this.mongoose.getCachedToken(address, chainId);

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
    async cacheTokenInMongoose(address, chainId, tokenData) {
        try {
            await this.mongoose.cacheToken(address, chainId, tokenData);
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
            await this.mongoose.clearTokenCache();
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
            await this.mongoose.removeTokenFromCache(address, chainId);
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
            return await this.mongoose.getAllCachedTokens();
        } catch (error) {
            console.error('Error getting all cached tokens from MongoDB:', error);
            return [];
        }
    }

    /**
     * Create database indexes for efficient token queries
     * Note: Indexes are now handled automatically by Mongoose schemas
     */
    async createTokenIndexes() {
        // Indexes are now handled automatically by Mongoose schemas
        console.log('Token indexes are handled automatically by Mongoose schemas');
    }
}

module.exports = TokenService;

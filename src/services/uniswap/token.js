const { Token } = require('@uniswap/sdk-core');
const { getContract } = require('viem');

class TokenService {
    constructor(provider) {
        this.provider = provider;
        this.tokenCache = new Map();
        this.erc20Abi = require('./abis/erc20.json');
    }

    async getToken(address, chainId = 42161) {
        const cacheKey = `${address}-${chainId}`;

        if (this.tokenCache.has(cacheKey)) {
            return this.tokenCache.get(cacheKey);
        }

        try {
            const tokenContract = getContract({
                address,
                abi: this.erc20Abi,
                client: this.provider
            });

            const [symbol, decimals, name] = await Promise.all([
                tokenContract.read.symbol(),
                tokenContract.read.decimals(),
                tokenContract.read.name()
            ]);

            const token = new Token(chainId, address, decimals, symbol, name);
            this.tokenCache.set(cacheKey, token);

            return token;
        } catch (error) {
            console.error(`Error creating token for ${address}:`, error);
            // Return fallback token
            return new Token(chainId, address, 18, 'UNKNOWN', 'Unknown Token');
        }
    }

    clearCache() {
        this.tokenCache.clear();
    }
}

module.exports = TokenService;

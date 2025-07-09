/**
 * Price calculation utilities for blockchain data
 */
const { isAddress, formatUnits } = require('viem');

/**
 * Calculates price of token0 in terms of token1 (token1/token0)
 * To calculate price of token1 in terms of token0, pass decimals in swapped order: (sqrtPriceX96, decimals1, decimals0)
 * @param {string|bigint} sqrtPriceX96 - The square root price from the pool
 * @param {number} decimalsToken0 - Number of decimals for token0
 * @param {number} decimalsToken1 - Number of decimals for token1
 * @returns {string} The calculated price
 */
function calculatePrice(sqrtPriceX96, decimalsToken0, decimalsToken1) {
    const priceNumerator = BigInt(sqrtPriceX96) ** 2n;
    const priceDenominator = 2n ** 192n;
    if (priceDenominator === 0n) return "Infinity";
    const displayDecimals = 8;

    const adjustedNumerator = priceNumerator * (10n ** BigInt(decimalsToken0 + displayDecimals));
    const adjustedDenominator = priceDenominator * (10n ** BigInt(decimalsToken1));

    if (adjustedDenominator === 0n) return "Infinity";
    const finalPriceBigNumber = adjustedNumerator / adjustedDenominator;
    return formatUnits(finalPriceBigNumber, displayDecimals);
}

/**
 * Check if a string is a valid Ethereum address
 * @param {string} address - The address to validate
 * @returns {boolean} True if address is valid
 */
function isValidEthereumAddress(address) {
    return isAddress(address);
}

module.exports = {
    calculatePrice,
    isValidEthereumAddress
};

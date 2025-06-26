/**
 * Price calculation utilities for blockchain data
 */
const { ethers } = require('ethers');

/**
 * Calculates price of token0 in terms of token1 (token1/token0)
 * To calculate price of token1 in terms of token0, pass decimals in swapped order: (sqrtPriceX96, decimals1, decimals0)
 * @param {string} sqrtPriceX96 - The square root price from the pool
 * @param {number} decimalsToken0 - Number of decimals for token0
 * @param {number} decimalsToken1 - Number of decimals for token1
 * @returns {string} The calculated price
 */
function calculatePrice(sqrtPriceX96, decimalsToken0, decimalsToken1) {
    const priceNumerator = ethers.BigNumber.from(sqrtPriceX96).pow(2);
    const priceDenominator = ethers.BigNumber.from(2).pow(192);
    if (priceDenominator.isZero()) return "Infinity";
    const displayDecimals = 8;

    const adjustedNumerator = priceNumerator.mul(ethers.BigNumber.from(10).pow(decimalsToken0 + displayDecimals)); 
    const adjustedDenominator = priceDenominator.mul(ethers.BigNumber.from(10).pow(decimalsToken1));

    if (adjustedDenominator.isZero()) return "Infinity";
    const finalPriceBigNumber = adjustedNumerator.div(adjustedDenominator);
    return ethers.utils.formatUnits(finalPriceBigNumber, displayDecimals);
}

/**
 * Check if a string is a valid Ethereum address
 * @param {string} address - The address to validate
 * @returns {boolean} True if address is valid
 */
function isValidEthereumAddress(address) {
    return ethers.utils.isAddress(address);
}

module.exports = {
    calculatePrice,
    isValidEthereumAddress
};

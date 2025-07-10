/**
 * Uniswap V3 Helper Functions
 * Utility functions for Uniswap V3 calculations
 */

const JSBI = require('jsbi');
const { Pool, Position } = require('@uniswap/v3-sdk');
const { Token } = require('@uniswap/sdk-core');
const { formatUnits } = require('viem');

/**
 * Convert a tick value to a human-readable price
 * @param {number} tick - The tick value
 * @param {number} token0Decimals - Decimals for token0
 * @param {number} token1Decimals - Decimals for token1
 * @returns {string} Formatted price
 */
function tickToHumanReadablePrice(tick, token0Decimals, token1Decimals) {
  // Use the formula price = 1.0001^tick
  const price = Math.pow(1.0001, tick);

  // Adjust for token decimals
  const adjustedPrice = price * Math.pow(10, token1Decimals - token0Decimals);

  // Format with appropriate precision based on price magnitude
  if (adjustedPrice < 0.001) {
    return adjustedPrice.toExponential(4);
  } else if (adjustedPrice < 1) {
    return adjustedPrice.toFixed(6);
  } else if (adjustedPrice < 1000) {
    return adjustedPrice.toFixed(4);
  } else {
    return adjustedPrice.toLocaleString(undefined, { maximumFractionDigits: 2 });
  }
}

/**
 * Calculate the amounts of token0 and token1 from liquidity
 * @param {bigint} liquidity - The position's liquidity
 * @param {number} tickLower - Lower tick boundary
 * @param {number} tickUpper - Upper tick boundary
 * @param {number} tickCurrent - Current pool tick
 * @param {number} token0Decimals - Decimals for token0
 * @param {number} token1Decimals - Decimals for token1
 * @param {number} feeTier - Pool fee tier (e.g., 3000 for 0.3%)
 * @returns {Object} Token amounts
 */
function calculateAmountsFromLiquidity(liquidity, tickLower, tickUpper, tickCurrent, token0Decimals, token1Decimals, feeTier = 3000) {
  try {
    // Convert bigint to JSBI (required by Uniswap SDK)
    const liquidityJSBI = JSBI.BigInt(liquidity.toString());

    // Create dummy tokens for calculation
    const token0 = new Token(1, '0x0000000000000000000000000000000000000000', token0Decimals);
    const token1 = new Token(1, '0x0000000000000000000000000000000000000001', token1Decimals);

    // Current sqrt price (approximation as we don't have the actual sqrt price)
    const sqrtRatioX96 = Math.sqrt(Math.pow(1.0001, tickCurrent)) * (2 ** 96);

    // Create a Pool instance
    const pool = new Pool(
      token0,
      token1,
      feeTier,
      JSBI.BigInt(Math.floor(sqrtRatioX96)),
      liquidityJSBI,
      tickCurrent
    );

    // Create a Position instance
    const position = new Position({
      pool,
      liquidity: liquidityJSBI,
      tickLower,
      tickUpper
    });

    // Get the token amounts
    const amounts = position.mintAmounts;

    // Format the amounts with the correct decimals
    const amount0 = formatUnits(amounts.amount0.toString(), token0Decimals);
    const amount1 = formatUnits(amounts.amount1.toString(), token1Decimals);

    return { amount0, amount1 };
  } catch (error) {
    console.error('Error calculating token amounts:', error);
    return { amount0: '0', amount1: '0' };
  }
}

/**
 * Check if a position is in range
 * @param {number} tickLower - Lower tick boundary
 * @param {number} tickUpper - Upper tick boundary
 * @param {number} tickCurrent - Current pool tick
 * @returns {boolean} True if position is in range
 */
function isPositionInRange(tickLower, tickUpper, tickCurrent) {
  return tickCurrent >= tickLower && tickCurrent < tickUpper;
}

module.exports = {
  tickToHumanReadablePrice,
  calculateAmountsFromLiquidity,
  isPositionInRange
};

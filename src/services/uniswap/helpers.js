/**
 * Uniswap V3 Helper Functions
 * Utilities for working with Uniswap V3 pools and positions
 */
const { Pool, Position, tickToPrice } = require('@uniswap/v3-sdk');
const { Token } = require('@uniswap/sdk-core');
const JSBI = require('jsbi');
const { formatUnits } = require('viem');

/**
 * Convert tick to human-readable price
 * @param {number} tick - The tick value
 * @param {Object} token0 - Token0 configuration
 * @param {Object} token1 - Token1 configuration
 * @returns {string} Human-readable price
 */
function tickToHumanReadablePrice(tick, token0, token1) {
  const price = tickToPrice(
    new Token(token0.chainId, token0.address, token0.decimals, token0.symbol),
    new Token(token1.chainId, token1.address, token1.decimals, token1.symbol),
    tick
  );
  return price.toFixed(6);
}

/**
 * Calculate token amounts from liquidity
 * @param {string} liquidity - Liquidity amount as string
 * @param {number} tickCurrent - Current tick
 * @param {number} tickLower - Lower tick
 * @param {number} tickUpper - Upper tick
 * @param {Object} token0 - Token0 configuration
 * @param {Object} token1 - Token1 configuration
 * @returns {Object} Token amounts
 */
function calculateAmountsFromLiquidity(liquidity, tickCurrent, tickLower, tickUpper, token0, token1) {
  const liquidityJSBI = JSBI.BigInt(liquidity);
  
  const token0Obj = new Token(token0.chainId, token0.address, token0.decimals, token0.symbol);
  const token1Obj = new Token(token1.chainId, token1.address, token1.decimals, token1.symbol);
  
  const pool = new Pool(
    token0Obj,
    token1Obj,
    3000, // fee tier
    '0', // sqrtPriceX96 (placeholder)
    liquidityJSBI,
    tickCurrent
  );
  
  const position = new Position({
    pool,
    liquidity: liquidityJSBI,
    tickLower,
    tickUpper
  });
  
  const amount0 = formatUnits(position.amount0.quotient.toString(), token0.decimals);
  const amount1 = formatUnits(position.amount1.quotient.toString(), token1.decimals);
  
  return { amount0, amount1 };
}

/**
 * Check if position is in range
 * @param {number} tickCurrent - Current tick
 * @param {number} tickLower - Lower tick
 * @param {number} tickUpper - Upper tick
 * @returns {boolean} True if position is in range
 */
function isPositionInRange(tickCurrent, tickLower, tickUpper) {
  return tickCurrent >= tickLower && tickCurrent <= tickUpper;
}

module.exports = {
  tickToHumanReadablePrice,
  calculateAmountsFromLiquidity,
  isPositionInRange
};

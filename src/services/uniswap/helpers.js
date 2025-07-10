/**
 * Uniswap V3 Helper Functions
 * Utilities for working with Uniswap V3 pools and positions
 */
const { Pool, Position, tickToPrice } = require('@uniswap/v3-sdk');
const { Token, CurrencyAmount } = require('@uniswap/sdk-core');
const { formatUnits } = require('viem');

/**
 * Create a CurrencyAmount from a token and amount
 * @param {Token} token - Uniswap SDK Token instance
 * @param {string|number|bigint} amount - Amount in token units
 * @returns {CurrencyAmount} CurrencyAmount instance
 */
function createCurrencyAmount(token, amount) {
  const amountString = typeof amount === 'bigint' ? amount.toString() : String(amount);
  return CurrencyAmount.fromRawAmount(token, amountString);
}

/**
 * Convert between token amounts with proper decimal handling
 * @param {Token} fromToken - Source token
 * @param {Token} toToken - Target token
 * @param {string|number|bigint} amount - Amount to convert
 * @param {number} exchangeRate - Exchange rate
 * @returns {CurrencyAmount} Converted amount
 */
function convertTokenAmount(fromToken, toToken, amount, exchangeRate) {
  const fromAmount = createCurrencyAmount(fromToken, amount);
  const convertedRaw = BigInt(fromAmount.quotient.toString()) *
    BigInt(Math.floor(exchangeRate * Math.pow(10, toToken.decimals)));
  const adjustedRaw = convertedRaw / BigInt(Math.pow(10, fromToken.decimals));

  return CurrencyAmount.fromRawAmount(toToken, adjustedRaw.toString());
}

/**
 * Calculate price with proper decimal handling using SDK
 * @param {Token} token0 - Token0 instance
 * @param {Token} token1 - Token1 instance
 * @param {bigint} sqrtPriceX96 - Square root price
 * @returns {string} Formatted price
 */
function calculatePriceFromSqrtRatio(token0, token1, sqrtPriceX96) {
  try {
    // Create dummy pool for price calculation
    const pool = new Pool(
      token0,
      token1,
      3000, // Default fee tier
      BigInt(sqrtPriceX96.toString()),
      BigInt('1000000000000000000'), // Dummy liquidity
      0 // Dummy tick
    );

    const price = pool.token0Price;
    return price.toSignificant(6);
  } catch (error) {
    console.error('Error calculating price from sqrt ratio:', error);
    return '0';
  }
}

/**
 * Format token amount with proper decimals
 * @param {Token} token - Token instance
 * @param {string|bigint} amount - Raw amount
 * @returns {string} Formatted amount
 */
function formatTokenAmount(token, amount) {
  const currencyAmount = createCurrencyAmount(token, amount);
  return currencyAmount.toExact();
}

/**
 * Convert tick to human-readable price (SDK-based version)
 * @param {number} tick - The tick value
 * @param {Object} token0 - Token0 configuration
 * @param {Object} token1 - Token1 configuration
 * @returns {string} Human-readable price
 */
function tickToHumanReadablePriceSDK(tick, token0, token1) {
  const price = tickToPrice(
    new Token(token0.chainId, token0.address, token0.decimals, token0.symbol),
    new Token(token1.chainId, token1.address, token1.decimals, token1.symbol),
    tick
  );
  return price.toFixed(6);
}

/**
 * Convert tick to human-readable price (backward compatibility version)
 * @param {number} tick - The tick value
 * @param {number} token0Decimals - Token0 decimals
 * @param {number} token1Decimals - Token1 decimals
 * @returns {string} Human-readable price
 */
function tickToHumanReadablePrice(tick, token0Decimals, token1Decimals) {
  const price = Math.pow(1.0001, tick);
  const adjustedPrice = price * Math.pow(10, token1Decimals - token0Decimals);
  const invertedPrice = 1 / adjustedPrice;

  if (invertedPrice < 0.001) {
    return invertedPrice.toExponential(4);
  } else if (invertedPrice < 1) {
    return invertedPrice.toFixed(6);
  } else if (invertedPrice < 1000) {
    return invertedPrice.toFixed(4);
  } else {
    return invertedPrice.toLocaleString(undefined, { maximumFractionDigits: 2 });
  }
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
  const liquidityBigInt = BigInt(liquidity);

  const token0Obj = new Token(token0.chainId, token0.address, token0.decimals, token0.symbol);
  const token1Obj = new Token(token1.chainId, token1.address, token1.decimals, token1.symbol);

  const pool = new Pool(
    token0Obj,
    token1Obj,
    3000, // fee tier
    '0', // sqrtPriceX96 (placeholder)
    liquidityBigInt,
    tickCurrent
  );

  const position = new Position({
    pool,
    liquidity: liquidityBigInt,
    tickLower,
    tickUpper
  });

  const amount0 = formatUnits(position.amount0.quotient.toString(), token0.decimals);
  const amount1 = formatUnits(position.amount1.quotient.toString(), token1.decimals);

  return { amount0, amount1 };
}

/**
 * Check if position is in range
 * @param {number} tickLower - Lower tick
 * @param {number} tickUpper - Upper tick
 * @param {number} tickCurrent - Current tick
 * @returns {boolean} True if position is in range
 */
function isPositionInRange(tickLower, tickUpper, tickCurrent) {
  return tickCurrent >= tickLower && tickCurrent < tickUpper;
}

module.exports = {
  // Enhanced SDK-based functions
  createCurrencyAmount,
  convertTokenAmount,
  calculatePriceFromSqrtRatio,
  formatTokenAmount,

  // Price calculation functions
  tickToHumanReadablePriceSDK,
  tickToHumanReadablePrice,

  // Position and liquidity functions
  calculateAmountsFromLiquidity,
  isPositionInRange
};

/**
 * Application constants
 * Centralized location for all fixed values used throughout the application
 */

const constants = {
    // Price formatting
    price: {
        displayDecimals: 8,
        priceFormatter: new Intl.NumberFormat('en-US', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 8,
        }),
    },

    // Time formatting
    time: {
        defaultFormat: { timeZone: 'UTC', hour12: false },
    },

    // Messages
    messages: {
        welcome: "Send a Uniswap v3 pool contract address to monitor its price. Use /notify <price> to set a price alert for monitored pools in this chat.",
        invalidAddress: "Send a valid Ethereum pool contract address to monitor, or use /notify <pool_address> <price> for alerts.",
        priceAlertTemplate: "🔔 Price Alert! 🔔\nPool: {symbol1}/{symbol0}\nPrice {direction} {targetPrice}.\nCurrent Price: {currentPrice}",
    },

    // Paths to ABI files
    abis: {
        erc20: '../../data/abis/erc20.json',
        uniswapV3Pool: '../../data/abis/uniswap-v3-pool.json',
    },
};

module.exports = constants;

/**
 * Application constants
 * Centralized location for all fixed values used throughout the application
 * @deprecated
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
        welcome: "Welcome! Use /pool to monitor pools or /wallet <address> to monitor wallet positions.",
        invalidAddress: "Use /pool <address> to monitor a valid Ethereum pool contract address.",
        priceAlertTemplate: "🔔 Price Alert! 🔔\\nPool: {symbol1}/{symbol0}\\nPrice {direction} {targetPrice}.\\nCurrent Price: {currentPrice}",
    },

    // Paths to ABI files
    abis: {
        erc20: '../../data/abis/erc20.json',
        uniswapV3Pool: '../../data/abis/v3-pool.json',
        nonfungiblePositionManager: '../../data/abis/v3-position-manager.json',
    },
};

module.exports = constants;

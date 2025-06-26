/**
 * Environment configuration
 * Loads and validates all required environment variables
 */
require('dotenv').config();

// Required environment variables
const requiredVars = ['ALCHEMY_API_KEY', 'TELEGRAM_BOT_TOKEN'];

// Check for required environment variables
for (const varName of requiredVars) {
    if (!process.env[varName]) {
        console.error(`Missing ${varName} environment variable.`);
        process.exit(1);
    }
}

/**
 * Environment configuration object
 * Central place for all environment variables and defaults
 */
const config = {
    // Blockchain configuration
    blockchain: {
        alchemyApiKey: process.env.ALCHEMY_API_KEY,
        network: process.env.BLOCKCHAIN_NETWORK || 'arbitrum',
    },

    // Telegram bot configuration
    telegram: {
        botToken: process.env.TELEGRAM_BOT_TOKEN,
        timezone: process.env.TELEGRAM_TIMEZONE || 'Asia/Phnom_Penh',
    },

    // Firebase configuration (for future use)
    firebase: {
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY,
    },
};

module.exports = config;

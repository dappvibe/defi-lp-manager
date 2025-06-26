# DeFi LP Manager

Automations to provide liquidity for Uniswap V3 pools with Telegram bot integration.

## Project Structure

```
defi-lp-manager/
├── src/              # Application source code
│   ├── config/       # Configuration files
│   ├── services/     # Business logic services
│   ├── utils/        # Utility functions
│   └── app.js        # Application entry point
├── data/             # Static data files
│   └── abis/         # Contract ABIs
└── tests/            # Test files
```

## Setup

1. Clone the repository
2. Install dependencies:
   ```
   npm install
   ```
3. Copy `.env.example` to `.env` and fill in your API keys
4. Start the application:
   ```
   npm start
   ```

## Environment Variables

- `ALCHEMY_API_KEY`: Your Alchemy API key for blockchain access
- `TELEGRAM_BOT_TOKEN`: Your Telegram bot token
- `TELEGRAM_TIMEZONE`: Timezone for displaying times (default: 'Asia/Phnom_Penh')

## Features

- Monitor Uniswap V3 pool prices via Telegram
- Set price alerts for specific thresholds
- Real-time updates on pool activity

## License

ISC

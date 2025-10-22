# Telegram Bot Service

## Rate Limiting

Telegram's Bot API has rate limits that can cause errors if exceeded. This implementation includes built-in throttling to prevent hitting these limits.

### Configuration

The throttling is configured via environment variables:

- `TELEGRAM_MAX_REQUESTS_PER_SECOND`: Maximum number of API requests per second (default: 30)
- `TELEGRAM_MESSAGE_EDIT_DELAY`: Minimum milliseconds between edits to the same message (default: 3000)

### Implementation Details

The telegram implementation uses `Throttler` utility to:

1. Limit overall API requests to stay under Telegram's rate limits
2. Add special handling for message edits, which have stricter rate limits

Throttling is applied to common methods:
- `sendMessage()`
- `editMessageText()`
- `answerCallbackQuery()`
- `sendPhoto()`

### Telegram API Limits

Telegram officially documents these limits:
- Overall limit: 30 messages per second
- Group limit: 20 messages per minute per group
- Editing messages: No more than one message every 3 seconds

If you're experiencing rate limit errors, consider adjusting the configuration values in your `.env` file.

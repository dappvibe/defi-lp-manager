/**
 * Get the current time formatted in the configured timezone
 * @param {Object} options - Formatting options for toLocaleTimeString
 * @returns {string} - Formatted time string
 */
function getTimeInTimezone(options = { hour12: false }) {
    const timezone = process.env.TELEGRAM_TIMEZONE || 'UTC';
    return new Date().toLocaleTimeString('en-US', { timeZone: timezone, ...options });
}

function moneyFormat(price) {
    return price.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

module.exports = {
    getTimeInTimezone,
    moneyFormat
};

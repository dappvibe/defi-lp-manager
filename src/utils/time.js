/**
 * Time utility functions
 */

/**
 * Get the current time formatted in a specific timezone
 * @param {string} tz - Timezone (e.g., 'Asia/Phnom_Penh', 'UTC', 'America/New_York')
 * @param {Object} options - Formatting options for toLocaleTimeString
 * @returns {string} - Formatted time string
 */
function getTimeInTimezone(tz, options = { hour12: false }) {
    return new Date().toLocaleTimeString('en-US', { timeZone: tz, ...options });
}

/**
 * Format a date in a specific timezone
 * @param {Date} date - Date object to format
 * @param {string} tz - Timezone
 * @param {Object} options - Formatting options
 * @returns {string} - Formatted date string
 */
function formatDateInTimezone(date, tz, options = {}) {
    return date.toLocaleString('en-US', { timeZone: tz, ...options });
}

module.exports = {
    getTimeInTimezone,
    formatDateInTimezone,
};

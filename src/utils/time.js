/**
 * Get the current time formatted in a specific timezone
 * @param {string} tz - Timezone (e.g., 'Asia/Phnom_Penh', 'UTC', 'America/New_York')
 * @param {Object} options - Formatting options for toLocaleTimeString
 * @returns {string} - Formatted time string
 */
function getTimeInTimezone(tz, options = { hour12: false }) {
    return new Date().toLocaleTimeString('en-US', { timeZone: tz, ...options });
}

module.exports = {
    getTimeInTimezone
};

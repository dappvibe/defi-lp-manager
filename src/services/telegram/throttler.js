/**
 * Throttler utility
 * Provides configurable rate limiting for API calls
 *
 * Used to prevent hitting Telegram API rate limits by spreading
 * API calls over time according to configured thresholds.
 *
 * For Telegram, typical limits are around 30 messages per second
 * with stricter limits for message edits (recommended 3 seconds between edits).
 */

/**
 * Creates a throttler that limits the rate of function calls
 */
class Throttler {
  /**
   * @param {Object} options - Throttling configuration options
   * @param {number} options.maxRequests - Maximum number of requests allowed in the time window
   * @param {number} options.timeWindowMs - Time window in milliseconds
   */
  constructor({ maxRequests = 30, timeWindowMs = 1000 } = {}) {
    this.maxRequests = maxRequests;
    this.timeWindowMs = timeWindowMs;
    this.queue = [];
    this.requestTimes = [];
    this.processing = false;
  }

  /**
   * Enqueues a function to be executed with throttling
   * @param {Function} fn - Function to execute
   * @param {Array} args - Arguments to pass to the function
   * @returns {Promise} Promise that resolves when the function executes
   */
  async throttle(fn, ...args) {
    return new Promise((resolve, reject) => {
      this.queue.push({ fn, args, resolve, reject });
      this._processQueue();
    });
  }

  /**
   * Process the queue of functions respecting rate limits
   * @private
   */
  async _processQueue() {
    if (this.processing || this.queue.length === 0) {
      return;
    }

    this.processing = true;

    try {
      // Clean up old timestamps outside the time window
      const now = Date.now();
      this.requestTimes = this.requestTimes.filter(
        time => now - time < this.timeWindowMs
      );

      // If we have capacity, process the next item
      if (this.requestTimes.length < this.maxRequests) {
        const item = this.queue.shift();
        this.requestTimes.push(now);

        try {
          const result = await item.fn(...item.args);
          item.resolve(result);
        } catch (error) {
          item.reject(error);
        }
      } else {
        // Wait until we have capacity again
        const oldestRequest = this.requestTimes[0];
        const waitTime = this.timeWindowMs - (now - oldestRequest);
        await new Promise(resolve => setTimeout(resolve, waitTime + 10)); // Add 10ms buffer
      }
    } finally {
      this.processing = false;
      // Continue processing if there are more items in the queue
      if (this.queue.length > 0) {
        this._processQueue();
      }
    }
  }
}

module.exports = Throttler;

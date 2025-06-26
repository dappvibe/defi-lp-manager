/**
 * Telegram command handlers
 * Exports all handlers for bot commands and messages
 */
const handleStart = require('./start');
const handleNotify = require('./notify');
const handleMonitorAddress = require('./monitor-address');

module.exports = {
  handleStart,
  handleNotify,
  handleMonitorAddress
};

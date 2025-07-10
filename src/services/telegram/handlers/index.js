/**
 * Telegram command handlers
 * Exports handler classes for bot to instantiate and bind
 */
const handleStart = require('./start');
const NotifyHandler = require('./notify');
const PoolHandler = require('./pool');
const WalletHandler = require('./wallet');

module.exports = {
  handleStart,
  NotifyHandler,
  PoolHandler,
  WalletHandler
};

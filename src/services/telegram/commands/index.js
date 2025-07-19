/**
 * Telegram command handlers
 * Exports handler classes for bot to instantiate and bind
 */
const StartHandler = require('./start');
const { PoolHandler } = require('./pool');
const WalletHandler = require('./wallet');
const HelpHandler = require("./help");
const { LpHandler, PositionMessage } = require('./lp');

// Export all handlers
module.exports = {
  StartHandler,
  HelpHandler,
  PoolHandler,
  WalletHandler,
  LpHandler,
  PositionMessage
};

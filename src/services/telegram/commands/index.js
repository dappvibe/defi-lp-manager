/**
 * Telegram command handlers
 * Exports handler classes for bot to instantiate and bind
 */
const StartHandler = require('./start');
const NotifyHandler = require('./notify');
const PoolHandler = require('./pool');
const WalletHandler = require('./wallet');
const HelpHandler = require("./help");
const { LpHandler, PositionMessage } = require('./lp');

module.exports = {
  StartHandler,
  HelpHandler,
  NotifyHandler,
  PoolHandler,
  WalletHandler,
  LpHandler,
  PositionMessage
};

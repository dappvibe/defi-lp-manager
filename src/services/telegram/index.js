/**
 * Telegram service exports
 */
const awilix = require("awilix");
const Bot = require('./bot');
const Throttler = require('./throttler');

module.exports = (container) => {
  container.register({
    bot: awilix.asClass(Bot).singleton(),
    throttler: awilix.asClass(Throttler).singleton()
  });
  container.loadModules(['./commands/*.js'], {
    cwd: __dirname,
    formatName: (name) => name + 'Handler',
    resolverOptions: {
      lifetime: awilix.Lifetime.SINGLETON,
    }
  })
  return container;
}

/**
 * Dependency Injection Container Configuration
 * Uses awilix to manage service dependencies
 */
const awilix = require('awilix');
const merge = require('lodash/merge');
const { config } = require('./config');
const PoolsConfig = require("./config/pools");

/**
 * Create and configure the dependency injection container
 * @returns {awilix.AwilixContainer} Configured container
 */
function createContainer(configOverrides = {}) {
  const container = awilix.createContainer({
    injectionMode: awilix.InjectionMode.CLASSIC
  });

  // Register configuration
  container.register({
    container: awilix.asValue(container),
    config: awilix.asValue(merge({}, config, configOverrides)),
    poolsConfig: awilix.asClass(PoolsConfig).singleton()
  });

  require('./services/blockchain')(container);
  require('./services/database')(container);
  require('./services/telegram')(container);
  require('./services/uniswap')(container);

  return container;
}

module.exports = createContainer;

/**
 * Dependency Injection Container Configuration
 * Uses awilix to manage service dependencies
 */
const awilix = require('awilix');

// Import services
const createProvider = require('./services/blockchain/provider');
const Db = require('./services/database/db');
const { WalletRegistry } = require('./services/wallet');
const Bot = require('./services/telegram/bot');
const ContractsService = require('./services/uniswap/contracts');
const { PoolService } = require('./services/uniswap/pool');
const { config } = require('./config');
const TokenService = require("./services/uniswap/token");

/**
 * Create and configure the dependency injection container
 * @returns {AwilixContainer} Configured container
 */
function createContainer() {
  const container = awilix.createContainer({
    injectionMode: awilix.InjectionMode.CLASSIC
  });

  // Register configuration
  container.register({
    config: awilix.asValue(config)
  });

  // Register database connection as singleton
  container.register({
    db: awilix.asClass(Db).singleton()
  });

  // Register blockchain provider as singleton
  container.register({
    provider: awilix.asFunction(() => createProvider()).singleton()
  });

  // Register telegram bot
  container.register({
    bot: awilix.asClass(Bot).singleton()
  });

  // Register wallet service
  container.register({
    walletRegistry: awilix.asClass(WalletRegistry).singleton()
  });

  // Register contracts service
  container.register({
    contractsService: awilix.asClass(ContractsService).singleton()
  });

  // Register pool service
  container.register({
    poolService: awilix.asClass(PoolService).singleton()
  });

  container.register({
    tokenService: awilix.asClass(TokenService).singleton()
  })

  return container;
}

module.exports = {
  createContainer
};

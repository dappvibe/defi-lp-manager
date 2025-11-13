const awilix = require('awilix');
const { config } = require('./config');
const PoolsConfig = require("./config/pools");

/**
 *
 */
class App {
  container = awilix.createContainer({
    injectionMode: awilix.InjectionMode.CLASSIC
  });

  constructor(extraServices = {}) {
    this.container.register({
      container: awilix.asValue(this.container), // to be accessed in service constructors, though discouraged
      config: awilix.asValue(config),

      // FIXME user adds their own pools from UI
      poolsConfig: awilix.asClass(PoolsConfig).singleton()
    });

    // Load modules
    require('./model')(this.container);
    require('./services/blockchain')(this.container);
    require('./services/database')(this.container);
    require('./services/telegram')(this.container);
    require('./services/uniswap')(this.container);

    this.container.register(extraServices);
  }

  async start() {
    await this.container.resolve('db').connect(config.db.uri)
      .then(() => console.log('Connected to MongoDB'));

    // FIXME do not connect on resolve. connect() instead so that it is controlled in tests
    this.container.resolve('provider');

    const telegram = this.container.resolve('telegram');
    // lib's polling waits for the first request to finish, so go on here optimistically
    telegram.start().then(() => console.log('First telegram poll request succeeded. Going on.'));
  }

  async stop() {
    await this.container.resolve('db').disconnect();
    await this.container.resolve('telegram').stop().then(() => console.log('Telegram polling stopped.'));
  }
}

module.exports = App;

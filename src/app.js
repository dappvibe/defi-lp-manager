const awilix = require('awilix');
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

      // require() must be here so that tests can load dotenv before this
      config: awilix.asValue(require('./config').config),

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
    const config = this.container.resolve('config');
    await this.container.resolve('db').connect(config.db.uri)
      .then(() => console.log('Connected to MongoDB'));

    // FIXME do not connect on resolve. connect() instead so that it is controlled in tests
    this.container.resolve('provider');

    // lib's polling waits for the first request to finish, so go on here optimistically
    this.container.resolve('telegram').start()
      .then(() => console.log('First telegram poll request succeeded. Going on.'));
  }

  async stop() {
    await this.container.resolve('db').disconnect();
    await this.container.resolve('telegram').stop().then(() => console.log('Telegram polling stopped.'));
  }
}

module.exports = App;

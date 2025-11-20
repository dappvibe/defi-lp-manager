const awilix = require('awilix');
const PoolsConfig = require("./config/pools");
const NodeCache = require("node-cache");
const {mongoose} = require("mongoose");

/**
 *
 */
class App {
  container = awilix.createContainer({
    injectionMode: awilix.InjectionMode.CLASSIC
  });

  constructor(extraServices = {}) {
    this.container.register({
      container: awilix.asValue(this.container), // to be accessed in service factories

      // require() must be here so that tests can load dotenv before this
      config: awilix.asValue(require('./config').config),

      mongoose: awilix.asValue(mongoose),

      // allows services to dep only on 'db' and refer models with db.model()
      db: awilix.asFunction((container, mongoose) => {
        // resolve all just registered Models so that they are available with just db.model('Name')
        // It allows other services to depend just on 'db' service and have access to all the models
        Object.keys(container.registrations)
          .filter(name => name.endsWith('Model'))
          .forEach(name => container.resolve(name));

        return mongoose; // alias
      }),

      // FIXME user adds their own pools from UI
      poolsConfig: awilix.asClass(PoolsConfig).singleton(),

      cache: awilix.asValue(new NodeCache({stdTTL: 0}))
    });

    // Load modules
    require('./model')(this.container);
    require('./services/blockchain')(this.container);
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

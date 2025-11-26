const App = require("../src/app");
const {createPublicClient, http} = require("viem");
const {arbitrum} = require("viem/chains");
const {asValue, asClass, asFunction} = require("awilix");
const {MockTelegram} = require("./services/telegram/_mocks");
const {getLocal} = require("mockthereum");

class MockApp extends App {
  ethnodeConfig = {
    //debug: true,
    unmatchedRequests: { proxyTo: 'https://arbitrum.drpc.org' } // paths are not allowed - limitation of mockttp
  }

  constructor() {
    super({
      // Mock specific replies in tests. By default proxy to public endpoint.
      ethnode: asFunction(() => getLocal()).singleton(),
      provider: asFunction(() => {
        throw new Error('Mock ethereum node is node started. Call MockApp.start()');
      }),
      telegram: asClass(MockTelegram).singleton(),
    });
  }

  async start() {
    const config = this.container.resolve('config');
    // resolve mongoose service here, not db so that tests can mock before resolving models
    const mongoose = this.container.resolve('mongoose');
    await mongoose.connect(config.db.uri, {
      serverSelectionTimeoutMS: 1000
    }).catch(e => {
      if (e.message.includes('timed out')) {
        throw new Error('MongoDB connection timeout. Did you start mongodb docker service?');
      } else throw e;
    });

    // Start a proxying mockthereum node and rewrite viem client to request it
    const ethnode = getLocal(this.ethnodeConfig);
    await ethnode.start();
    this.container.register({
      ethnode: asValue(ethnode),
      provider: asValue(createPublicClient({
        chain: arbitrum,
        transport: http(ethnode.url)
      }))
    })
  }
  async stop() {}
}

module.exports = MockApp;

const App = require("../../src/app");
const {createPublicClient, http} = require("viem");
const {arbitrum} = require("viem/chains");
const {asValue, asClass} = require("awilix");
const {MockTelegram} = require("../services/telegram/_mocks");

class MockApp extends App {
  constructor() {
    super({
      // Use public endpoint for tests
      provider: asValue(createPublicClient({
        chain: arbitrum,
        transport: http()
      })),
      telegram: asClass(MockTelegram)
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
  }

  async stop() {}
}

module.exports = MockApp;

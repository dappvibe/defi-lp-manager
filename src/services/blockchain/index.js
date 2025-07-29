const awilix = require("awilix");
const createProvider = require('./provider');

module.exports = (container) => {
  container.register({
    provider: awilix.asFunction(createProvider).singleton()
  });
}

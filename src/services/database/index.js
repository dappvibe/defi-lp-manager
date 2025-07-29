const awilix = require("awilix");
const { mongoose } = require('mongoose');

module.exports = (container) => {
  container.register({
    mongoose: awilix.asValue(mongoose),
  });
  container.loadModules(['./models/*Model.js'], {
    cwd: __dirname,
    formatName: 'camelCase',
    resolverOptions: {
      lifetime: awilix.Lifetime.SINGLETON,
    }
  });
}

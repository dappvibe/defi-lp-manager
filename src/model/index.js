const awilix = require("awilix");
const { mongoose } = require('mongoose');

module.exports = (container) => {
  container.loadModules(['./*Model.js'], {
    cwd: __dirname,
    formatName: 'camelCase',
    resolverOptions: {
      lifetime: awilix.Lifetime.SINGLETON,
    }
  });
}

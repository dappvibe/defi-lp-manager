const awilix = require("awilix");

module.exports = (container) => {
  // service name is the file name
  container.loadModules(['./*Model.js'], {
    cwd: __dirname,
    resolverOptions: {
      lifetime: awilix.Lifetime.SINGLETON,
    }
  });
}

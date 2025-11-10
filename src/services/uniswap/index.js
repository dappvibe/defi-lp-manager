module.exports = (container) => {
  require("./contracts")(container);
  require("./position")(container);
  require("./pool")(container);
};

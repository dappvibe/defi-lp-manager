module.exports = (container) => {
  require("./contracts")(container);
  require("./position")(container);
};

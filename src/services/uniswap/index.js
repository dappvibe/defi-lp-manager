module.exports = (container) => {
  require("./contracts")(container);
  require("./token")(container);
  //require("./position")(container);
  require("./pool")(container);
};

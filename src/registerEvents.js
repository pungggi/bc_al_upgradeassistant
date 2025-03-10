const { registerfileEvents } = require("./events/registerFileEvents");

function registerEvents(context) {
  registerfileEvents(context);
}

module.exports = {
  registerEvents,
};

// Delegate dashboard routing to modular src/dashboard/index.js while retaining middleware exports
const dashboardModule = require("./dashboard/index");
const middleware = require("./dashboard/middleware");
const auth = require("./utils/dashboardAuth");

module.exports = dashboardModule;
module.exports.checkAuth = middleware.checkAuth;
module.exports.csrfOk = (req) => {
  const token = req.cookies?.["aria_session"];
  const given = req.body?._csrf || req.headers["x-csrf-token"] || req.query?._csrf || "";
  return auth.validateCsrfToken(token, given);
};
module.exports.csrfFor = (req) => {
  const token = req.cookies?.["aria_session"];
  return auth.generateCsrfToken(token);
};


/*
    Routes File

    Tells app to listen for url-routes,
    passes work off to Controllers
*/

module.exports = function (app, ioPromise){
  var stocks = require("../controllers/orders.js", ioPromise); //eslint-disable-line global-require
  app.post("/place_order", stocks.create);

};

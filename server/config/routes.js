var stocks = require("../controllers/orders.js");
var users = require("../controllers/users.js");

/*
    Routes File

    Tells app to listen for url-routes,
    passes work off to Controllers
*/

module.exports = function (app, ioPromise, db){
  users.setDB(db);
  stocks.setIOPromise(ioPromise);
  stocks.setDB(db);
  app.post("/register", users.register);
  app.post("/login", users.login);
  app.post("/guestlogin", users.guest);
  app.get("/logout",users.logout);
  app.post("/order", stocks.create);
  app.get("/companyData", stocks.getGlobalData);
  app.get("/companyData/:company", stocks.getCompanyData);
  app.get("/userData", stocks.getUserData);
  app.delete("/order/:id", stocks.cancel);
};

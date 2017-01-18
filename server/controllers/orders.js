var pg = require("pg-promise");
var q = require("q");
var db = pg.connect({
  "database": "stocks",
  "user": "coder65535",
  "password": "Brian1",
  "host": "localhost",
  "port": "5432"
});




module.exports = {
  create:function(req, res){
    var buy = req.body.type === "buy";
    db.one();
  }
};

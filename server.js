var express = require("express");
var app = express();

var q = require("q");

var socketIO = require("socket.io");

app.use(require("body-parser").json());

require("./server/config/mongoose.js");
var static_loader = require("utils");

var ioDelayed = q.defer();

var routes = require("./server/config/routes.js");
routes(app, ioDelayed.promise);


app.get(/\/partials\/(.+)/, function(req, res){
  static_loader.serve_partial(res, req.params[0]);
});
app.get(/\/cdn\/(.+)/, function(req, res){
  static_loader.serve_script(res, req.params[0]);
});
app.set("views", __dirname + "/client");
app.set("view engine", "ejs");
app.get("/", function(req, res){
  static_loader.serve_static(res, "index.html");
});
app.get("/trading/", function(req, res){
  static_loader.serve_static(res, "stocks.html");
});

var server = app.listen(8000, function () {
  console.log("Listening");
});

var io = socketIO.listen(server);
ioDelayed.resolve(io);
io.on("connection", function(socket){
  socket.on("main", function(){
    for (let room in socket.rooms){
      if (room.charAt(0) === "$"){
        socket.leave(room);
      }
    }
  });
  socket.on("company", function(symbol){
    socket.join(symbol);
  });
});

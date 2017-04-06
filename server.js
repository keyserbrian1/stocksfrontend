var express = require("express");
var app = express();

var q = require("q");

var socketIO = require("socket.io");

app.use(require("body-parser").json());

var pgp = require("pg-promise")();
var db = pgp({
  "database": "stocks",
  "user": "coder65535",
  "password": "Brian1",
  "host": "localhost",
  "port": "5432"
});
var session = require("express-session");
var pgSession = require("connect-pg-simple")(session);
app.use(session({
  store: new pgSession({
    pg:pgp.pg,
    conString:{
      "database": "stocks",
      "user": "coder65535",
      "password": "Brian1",
      "host": "localhost",
      "port": "5432"
    }
  }),
  saveUninitialized:true,
  secret:"SecretPassForSessionData",
  resave:"keep"
}));

var static_loader = require("utils");

// var bodyParser = require("body-parser");
// app.use(bodyParser.urlencoded({extended: true}));

var ioDelayed = q.defer();

var routes = require("./server/config/routes.js");
routes(app, ioDelayed.promise, db);

static_loader.install(app);

app.set("views", __dirname + "/client");
app.set("view engine", "ejs");
app.get("/", function(req, res){
  if (req.session.user){
    res.redirect("/trading/");
    return;
  }
  static_loader.serve_static(res, "index.html");
});
app.get("/trading/", function(req, res){
  if (!req.session.user){
    res.redirect("/");
    return;
  }
  static_loader.serve_static(res, "stocks.html");
});

var server = app.listen(8000, function () {
  console.log("Listening");
});

var io = socketIO.listen(server);
// var ioSession = require("io-session");
// io.use(ioSession(session));
io.on("connection", function(socket){
  socket.on("company", function(symbol){
    socket.join(symbol);
  });
  socket.on("leaveCompany", function(symbol){
    socket.leave(symbol);
  });
});
ioDelayed.resolve(io);

//once everything else is set up, launch the bots.

var cp = require("child_process");
var ordersCtrl = require("./server/controllers/orders.js");
var bots = cp.spawn("python",["-u","../stocks/manage.py","launchbots"]);
var error = false;
bots.stdout.on("data", function (data) {
  data = data.toString();
  if (!error){
    ordersCtrl.createForBot(data);
    console.log("Bot order:"+data);
  }
});

bots.stderr.on("data", function (data) {
  if (!error){console.error("Python bot error: ");}
  console.error(data.toString());
  setTimeout(()=>process.exit(-1),1000);
  error = true;
});


var bcrypt = require("bcrypt");
var pg = require("pg-promise")();
var db = pg({
  "database": "stocks",
  "user": "coder65535",
  "password": "Brian1",
  "host": "localhost",
  "port": "5432"
});


module.exports = {
  register: function(req, res){
    console.log("start");
    var data = req.body;
    if (data.password !== data.passconf){
      res.json({success:false, err:{header:"Error in register:",items:["Password does not match confirmation"]}});
      return;
    }
    bcrypt.hash(data.password,15).then((pass)=>db.one("INSERT INTO users_user(email, username, password, cash, created_at, updated_at) VALUES($1,$2,$3,1000000, NOW(), NOW()) RETURNING id",[data.email, data.username, pass]))
    .then((user)=>{
      console.log("new user ",user);
      return db.task(t=>{
        return t.map("SELECT * FROM trading_company",null,(company=>{
          return t.any("INSERT INTO trading_stock(shares, created_at, updated_at, company_id, owner_id) VALUES (10, NOW(), NOW(), $1, $2)",[company.id, user.id]);
        })).then(t.batch);
      }).then(()=>{
        req.session.user = user.id;
        res.json({success:true});
        return null;
      });
    }).catch((err)=>{
      console.log("here");
      res.json({success:false, err:{header:"Error in register:",items:[err.message||err]}});
    });
  },
  login: function(req, res){
    var data = req.body;
    console.log("hi");
    console.log(data);
    db.oneOrNone("SELECT * FROM users_user WHERE username=$1",[data.username]).then(function(user){
      if (!user){
        throw "User not found";
      }
      return Promise.all([user, bcrypt.compare(req.body.password, user.password)]);
    }).then(function(result){
      var valid = result[1];
      if (valid){
        req.session.user = result[0].id;
        res.json({success:true});
      } else {
        throw "Bad password";
      }
      return null;
    }).catch(function(err){
      res.json({success:false, err:{header:"Error in login.",items:[err.message||err]}});
    });
  },
  logout:function(req, res){
    delete req.session.user;
    res.redirect("/");
  }
};

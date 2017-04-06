
var bcrypt = require("bcrypt");
var db = null;


module.exports = {
  setDB:function(dbObj){
    db = dbObj;
  },
  register: function(req, res){
    var data = req.body;
    if (data.password !== data.passconf){
      res.json({success:false, err:{header:"Error in register:",items:["Password does not match confirmation"]}});
      return;
    }
    bcrypt.hash(data.password,15).then((pass)=>db.one("INSERT INTO users_user(email, username, password, cash, created_at, updated_at, is_bot) VALUES($1,$2,$3,10000, NOW(), NOW(), false) RETURNING id",[data.email, data.username, pass]))
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
  guest:function(req, res){
    var id = Math.floor(Math.random() * (1000000 - 100000) + 100000);
    return db.oneOrNone("SELECT * FROM users_user WHERE id=$1",[id]).then(user=>{
      if (user){
        return this.guest(req, res);
      }
      return db.one("INSERT INTO users_user(id, email, username, password, cash, created_at, updated_at, is_bot) VALUES($1,'Guest',$2,'Guest',10000, NOW(), NOW(), false) RETURNING id",[id, "Guest-"+id])
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
      });
    });
  },
  logout:function(req, res){
    delete req.session.user;
    res.redirect("/");
  }
};

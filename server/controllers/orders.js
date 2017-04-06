var db = null;

var IO = null;
var ioPromise=null;

var queue = require("async-q").queue((order)=>{
  if (order.botOrder){
    return processBotOrder(order);
  }
  if (order.cancelOrder){
    return cancelOrder(order.id);
  } else if (order.buy === true){
    return processBuyOrder(order);
  } else {
    return processSellOrder(order);
  }
}, 1);


function processBotOrder(order){
  return db.any("SELECT * FROM trading_order WHERE owner_id = ${owner} AND company_id = ${company} AND buy_order <> ${buy} AND open = true ORDER BY created_at ASC",order).then(oldOrders=>{
    return db.tx(t=>{
      var trans = [];
      for (let old of oldOrders){
        if (old.shares > order.shares){
          old.shares -= order.shares;
          trans.push(t.any("UPDATE trading_order SET shares=${shares} WHERE id=${id}",old));
          order.shares = 0;
          break;
        } else {
          order.shares -= old.shares;
          trans.push(t.any("DELETE FROM trading_order WHERE id=$1",[old.id]));
        }
      }
      return t.batch(trans);
    }).then(()=>{
      if (order.shares){
        if (order.buy){
          return processBuyOrder(order);
        } else {
          return processSellOrder(order);
        }
      }
      return null;
    });
  });
}

function processBuyOrder(order){
  var shares = order.shares;
  return Promise.all([
    db.one("SELECT * FROM users_user WHERE id=$1",[order.owner]),
    db.any("SELECT * FROM trading_order WHERE company_id = ${company} AND buy_order = false AND open = true AND owner_id <> ${owner} AND price <= ${price} ORDER BY price ASC, created_at ASC", order)
  ]).then((data)=>{
    var user = data[0];
    var sells = data[1];
    return db.tx((t)=>{
      var queries = [];
      for (let sell of sells){
        sell.price=parseFloat(sell.price);
        if (sell.shares > order.shares){
          sell.shares -= order.shares;
          queries.push(t.any("UPDATE trading_order SET shares=${shares},updated_at=NOW() WHERE id=${id}", sell));
          queries.push(t.any("INSERT INTO trading_order(shares, open,  price, buy_order, created_at, updated_at, company_id, owner_id) VALUES ($1, false, $2, false, $3, NOW(), $4, $5)",[order.shares, sell.price, sell.created_at, sell.company_id, sell.owner_id]));
          queries.push(t.any("UPDATE users_user SET cash = cash + $1,updated_at=NOW() WHERE id=$2", [order.shares*sell.price, sell.owner_id]));
          user.cash -= order.shares*sell.price;
          order.shares = 0;
          if (user.cash < 0) {
            throw "Insufficient cash";
          }
          break;
        } else {
          order.shares -= sell.shares;
          queries.push(t.any("UPDATE trading_order SET open=false,updated_at=NOW() WHERE id=${id}",sell));
          queries.push(t.any("UPDATE users_user SET cash = cash + $1,updated_at=NOW() WHERE id=$2",[sell.shares*sell.price, sell.owner_id]));
          user.cash -= sell.shares*sell.price;
          if (user.cash < 0) {
            throw "Insufficient cash";
          }
          if (order.shares===0) {break;}
        }
      }
      if (order.shares !== 0) {
        queries.push(t.any("INSERT INTO trading_order(shares, open, price, buy_order, created_at, updated_at, company_id, owner_id) VALUES (${shares}, true, ${price}, true, NOW(), NOW(), ${company}, ${owner})", order));
        user.cash -= order.shares*order.price;
        if (user.cash < 0) {
          throw "Insufficient cash";
        }
      }
      queries.push(t.any("UPDATE users_user SET cash = $1,updated_at=NOW() WHERE id=$2",[user.cash, order.owner]));
      queries.push(t.oneOrNone("SELECT * FROM trading_stock WHERE company_id=${company} AND owner_id=${owner}",order).then((holding)=>{
        if (holding){
          return t.any("UPDATE trading_stock SET shares=shares+$1,updated_at=NOW() WHERE owner_id = $2 AND company_id=$3",[shares-order.shares, order.owner, order.company]);
        } else {
          return t.any("INSERT INTO trading_stock(shares, created_at, updated_at, company_id, owner_id) VALUES ($1, NOW(), NOW(), $2, $3)",[shares-order.shares, order.company, order.owner]);
        }
      }));
      return t.batch(queries);
    });
  });
}

function processSellOrder(order){
  return Promise.all([
    db.one("SELECT * FROM trading_stock WHERE owner_id=${owner} AND company_id=${company}",order),
    db.any("SELECT * FROM trading_order WHERE company_id = ${company} AND buy_order = true AND owner_id <> ${owner} AND price >= ${price} ORDER BY price DESC, created_at ASC", order)
  ]).then((data)=>{
    var user = data[0];
    var buys = data[1];
    if (user.shares < order.shares) {throw "Insufficient shares";}
    return db.tx((t)=>{
      var queries = [];
      queries.push(t.any("UPDATE trading_stock SET shares = shares-${shares} WHERE owner_id=${owner} AND company_id=${company}",order));
      for (let buy of buys){
        buy.price=parseFloat(buy.price);
        if (buy.shares > order.shares){
          buy.shares -= order.shares;
          queries.push(t.any("UPDATE trading_order SET shares=${shares} WHERE id=${id}", buy));
          queries.push(t.any("INSERT INTO trading_order(shares, open,  price, buy_order, created_at, updated_at, company_id, owner_id) VALUES ($1, false, $2, true, $3, NOW(), $4, $5)",[order.shares, buy.price, buy.created_at, buy.company_id, buy.owner_id]));
          queries.push(t.oneOrNone("SELECT * FROM trading_stock WHERE company_id=${company_id} AND owner_id=${owner_id}",buy).then(stock=>{
            if (stock){
              return t.any("UPDATE trading_stock SET shares = shares + $1 WHERE owner_id=$2 AND company_id=$3", [order.shares, buy.owner_id, buy.company_id]);
            } else {
              return t.any("INSERT INTO trading_stock(shares, created_at, updated_at, company_id, owner_id) VALUES(${shares}, NOW(), NOW(), ${company_id}, ${owner_id})",buy);
            }
          }));
          queries.push(t.any("UPDATE users_user SET cash = cash + $1 WHERE id=$2",[order.shares*buy.price, user.owner_id]));
          order.shares = 0;
          break;
        } else {
          order.shares -= buy.shares;
          queries.push(t.any("UPDATE trading_order SET open=false,updated_at=NOW() WHERE id=$1",[buy.id]));
          queries.push(t.oneOrNone("SELECT * FROM trading_stock WHERE company_id=${company_id} AND owner_id=${owner_id}",buy).then(stock=>{
            if (stock){
              return t.any("UPDATE trading_stock SET shares = shares + $1 WHERE owner_id=$2 AND company_id=$3", [buy.shares, buy.owner_id, buy.company_id]);
            } else {
              return t.any("INSERT INTO trading_stock(shares, created_at, updated_at, company_id, owner_id) VALUES(${shares}, NOW(), NOW(), ${company_id}, ${owner_id})",buy);
            }
          }));
          queries.push(t.any("UPDATE users_user SET cash = cash + $1 WHERE id=$2",[buy.shares*buy.price, user.owner_id]));
          if (order.shares===0) {break;}
        }
      }
      if (order.shares !== 0) {
        queries.push(t.any("INSERT INTO trading_order(shares, open, price, buy_order, created_at, updated_at, company_id, owner_id) VALUES (${shares}, true, ${price}, false, NOW(), NOW(), ${company}, ${owner})", order));
      }
      return t.batch(queries);
    });
  });
}

function cancelOrder(id){
  return db.tx(t=>{
    return t.one("SELECT * FROM trading_order WHERE id=$1",[id]).then(order=>{
      if (order.buy_order){
        return t.any("UPDATE users_user SET cash=cash+$1 WHERE id=$2",[order.price*order.shares, order.owner_id]);
      } else {
        return t.oneOrNone("SELECT * FROM trading_stock WHERE owner_id=${owner} AND company_id=${company}",order).then(stock=>{
          if (stock){
            return t.any("UPDATE trading_stock SET shares=shares+${shares} WHERE company_id=${company_id} AND owner_id=${owner_id}",order);
          } else {
            return t.any("INSERT INTO trading_stock(shares, created_at, updated_at, company_id, owner_id) VALUES(${shares}, NOW(), NOW(), ${company_id}, ${owner_id})",order);
          }
        });
      }
    }).then(()=>{
      return t.any("DELETE FROM trading_order WHERE id=$1",id);
    });
  }).then(()=>{
    return true;
  }).catch(err=>{
    console.error(err);
    return false;
  });
}

function getBids(id, task){
  return (task?task:db).any("SELECT price, shares FROM trading_order WHERE company_id=$1 AND buy_order=true AND open=true ORDER BY price DESC, created_at ASC",[id]).then(arr=>{
    return arr.map(item=>{
      item.price = parseFloat(item.price);
      return item;
    });
  });
}

function getAsks(id, task){
  return (task?task:db).any("SELECT price, shares FROM trading_order WHERE company_id=$1 AND buy_order=false AND open=true ORDER BY price ASC, created_at ASC",[id]).then(arr=>{
    return arr.map(item=>{
      item.price = parseFloat(item.price);
      return item;
    });
  });
}

function getHistory(id, task){
  return (task?task:db).any("SELECT price, shares FROM trading_order WHERE company_id=$1 AND open=false ORDER BY updated_at DESC",[id]).then(arr=>{
    return arr.map(item=>{
      item.price = parseFloat(item.price);
      return item;
    });
  });
}

function getIndustries(id, task){
  return (task?task:db).many("SELECT trading_industry.name AS name, parent.name AS parent FROM trading_company JOIN trading_company_industries on trading_company_industries.company_id = trading_company.id JOIN trading_industry ON trading_company_industries.industry_id = trading_industry.id JOIN trading_industry as parent ON trading_industry.parent_id = parent.id WHERE trading_company.id=$1",[id]);
}

function getUser(id, task){
  if (!task){
    return db.task(t=>{
      return getUser(id, t);
    });
  } else {
    return task.batch([task.any("SELECT trading_stock.shares AS shares, trading_company.name AS name, trading_company.symbol AS symbol FROM trading_stock JOIN trading_company ON trading_company.id=company_id WHERE trading_stock.owner_id = $1",[id]), task.any("SELECT trading_order.id AS id, trading_order.shares AS shares, trading_order.price AS price, trading_order.created_at AS created_at, trading_order.buy_order AS buy_order, trading_company.name AS name, trading_company.symbol AS symbol FROM trading_order JOIN trading_company ON trading_company.id=company_id WHERE trading_order.owner_id = $1 AND trading_order.open=true",[id]), task.one("SELECT cash FROM users_user WHERE id = $1",[id])]);
  }
}

function getIO(){
  return IO?IO:(()=>{throw "Server is not ready";});
}

module.exports = {
  setIOPromise:function(iop){
    ioPromise = iop;
    ioPromise.then((ioObj)=>{
      IO = ioObj;
      return null;
    }).catch(()=>console.log);
  },
  setDB:function(dbObj){
    db = dbObj;
  },
  create:function(req, res){
    var order = req.body;
    order.owner = req.session.user;
    db.one("SELECT id, name FROM trading_company WHERE symbol=$1",[order.symbol]).then(val=>{
      var id = val.id;
      var name = val.name;
      order.company=id;
      return queue.push(order).then(()=>{
        return db.task((t)=>{
          return t.batch([getBids(id, t), getAsks(id, t), getHistory(id, t)]);
        }).then((data)=>{
          var io = getIO();
          var [bids, asks, hist] = data;
          var [bid, ask, last] = [bids, asks, hist].map(x=>x.length?x[0].price:NaN);
          io.emit("globalUpdate", {symbol:order.symbol, newCompanyData:{symbol:order.symbol, bid:bid, ask:ask, last_trade:last, name:name}});
          io.to(order.symbol).emit("companyUpdate", {bids:bids, asks:asks});
          res.json({});
          return null;
        });
      }).catch(err=>{
        res.json({err:err});
      });
    }).catch(err=>{
      console.error(err);
    });
  },
  createForBot:function(botString){
    var [buyString, ...nums] = botString.split(" ");
    var buy = (buyString==="Buy");
    var [bot, symbol, shares, price] = nums;
    if (!price){
      return; //sometimes, there's a malformed order.
    }
    bot = parseFloat(bot);
    shares = parseFloat(shares);
    price = parseFloat(price);
    var order = {
      owner:bot,
      symbol:symbol,
      shares:shares,
      price:price,
      buy:buy,
      botOrder:true
    };
    db.one("SELECT id, name FROM trading_company WHERE symbol=$1",[order.symbol]).then(val=>{
      var id = val.id;
      var name = val.name;
      order.company=id;
      return queue.push(order).then(()=>{
        return db.task((t)=>{
          return t.batch([getBids(id, t), getAsks(id, t), getHistory(id, t)]);
        }).then((data)=>{
          var io = getIO();
          var [bids, asks, hist] = data;
          var [bid, ask, last] = [bids, asks, hist].map(x=>x.length?x[0].price:NaN);
          io.emit("globalUpdate", {symbol:order.symbol, newCompanyData:{symbol:order.symbol, bid:bid, ask:ask, last_trade:last, name:name}});
          io.to(order.symbol).emit("companyUpdate", {bids:bids, asks:asks});
          return null;
        });
      }).catch(err=>{
        console.error(err);
      });
    }).catch(err=>{
      console.error(err);
    });
  },
  cancel:function(req,res){
    db.one("SELECT trading_order.owner_id AS owner_id, trading_order.company_id AS company_id, trading_company.symbol AS symbol FROM trading_order JOIN trading_company ON trading_company.id=trading_order.company_id WHERE id=$1", [req.params.id]).then(order=>{
      if (order.owner_id !== req.session.user){
        res.json({err:"Invalid order: not your order"});
        return null;
      } else {
        return queue.push({cancelOrder:true,id:req.params.id}).then(count=>{
          if (count){
            return db.task((t)=>{
              return t.batch([getBids(order.company_id, t), getAsks(order.company_id, t), getHistory(order.company_id, t), t.one("SELECT name FROM trading_company WHERE id=$1",[order.company_id])]);
            }).then((data)=>{
              var io = getIO();
              var [bids, asks, hist, name] = data;
              var [bid, ask, last] = [bids, asks, hist].map(x=>x.length?x[0].price:NaN);
              io.emit("globalUpdate", {symbol:order.symbol, newCompanyData:{symbol:order.symbol, bid:bid, ask:ask, last_trade:last, name:name}});
              io.to(order.symbol).emit("companyUpdate", {bids:bids, asks:asks});
              res.json({});
              return null;
            }).catch(err=>{
              console.error(err);
              res.json({err:err});
            });
          } else {
            res.json({err:"Invalid order: already completed"});
            return null;
          }
        }).catch(()=>{
          res.json({err:"Invalid order: not found"});
        });
      }
    }).catch(err=>{
      console.error(err);
    });
  },
  getGlobalData:function(req, res){
    db.task(t=>{
      return t.map("SELECT * FROM trading_company",null,company=>{
        return t.batch([getBids(company.id, t), getAsks(company.id, t), getHistory(company.id,t), getIndustries(company.id,t)]).then(data=>{
          let [bids, asks, history, industries] = data;
          return [company, bids, asks, history, industries];
        });
      }).then(t.batch);
    }).then(data=>{
      var companyData = {};
      for (let companyBlob of data){
        let [company, bids, asks, history, industries] = companyBlob;
        companyData[company.symbol] = company;
        companyData[company.symbol].bid = bids[0]?bids[0].price:null;
        companyData[company.symbol].ask = asks[0]?asks[0].price:null;
        companyData[company.symbol].last_trade = history[0]?history[0].price:null;
        companyData[company.symbol].industries = industries;
      }
      res.json(companyData);
      return null;
    }).catch(err=>{
      console.error(err);
      res.json({err:err});
    }).catch(err=>{
      console.error(err);
    });
  },
  getCompanyData:function(req, res){
    db.task(t=>{
      return t.one("SELECT id FROM trading_company WHERE symbol=$1",[req.params.company]).then(id=>{
        return t.batch([getBids(id.id, t), getAsks(id.id, t), getUser(req.session.user)]).then(data=>{
          var [bids, asks, [portfolio, orders, cash]] = data;
          res.json({bids:bids, asks:asks, user:{portfolio:portfolio, orders:orders, cash:parseFloat(cash.cash)}});
          return null;
        });
      });
    }).catch(err=>{
      console.error(err);
      res.json({err:err});
    }).catch(err=>{
      console.error(err);
    });
  },
  getUserData:function(req, res){
    getUser(req.session.user).then(data=>{
      res.json({portfolio:data[0], orders:data[1], cash:data[2].cash});
      return null;
    }).catch(err=>{
      console.error(err);
      res.json({err:err});
    }).catch(err=>{
      console.error(err);
    });
  }
};

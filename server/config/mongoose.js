var mongoose = require("mongoose");
mongoose.connect("mongodb://localhost/SEmimics");

//requires every model
require("../models/question.js");

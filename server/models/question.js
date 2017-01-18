/*
    Registers Model for TodoItem
*/

var mongoose = require("mongoose");

var answerSchema = new mongoose.Schema({
  author: String,
  answer: String,
  details: String,
  likes: {type:Number, default:0}
});

var questionSchema = new mongoose.Schema({
  question: String,
  description: String,
  answers: [answerSchema]
});

mongoose.model("question", questionSchema);

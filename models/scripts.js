const mongoose = require('mongoose');

const sheetSchema = new mongoose.Schema({
   "name": String,
  "sort": Number,
  "siteId": String,
  "sheetId": String,
  "text": String
});

module.exports = mongoose.model('sheet', sheetSchema);

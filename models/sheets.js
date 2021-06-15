const mongoose = require('mongoose');

const scriptObj =  {
  name: String,
  text: String
};

const sheetSchema = new mongoose.Schema({
  "name": String,
  "htmlButton": String,
  "onStart": String,
  "sort": Number,
  "siteId": String,
  "author": String,
  "db": {
    "schema": {},
    "url" String
  },
  "ui": {
    "js": String,
    "html": String,
    "css": String,
    "scripts": [ scriptObj ]
  }
});

module.exports = mongoose.model('sheet', sheetSchema);

const mongoose = require('mongoose');

const blockCell = {
  width: Number,
  rows: Array
};

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
    "schema": {}
  },
  "ui": {
    "js": String,
    "html": String,
    "css": String,
    "scripts": [ scriptObj ],
    "blocks": [ blockCell ]
  }
});

module.exports = mongoose.model('sheet', sheetSchema);

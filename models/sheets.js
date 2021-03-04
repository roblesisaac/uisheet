const mongoose = require('mongoose');

const blockCell = {
  width: Number,
  rows: Array
};

const scriptObj =  {
  name: String,
  text: String
};

const uploadStatus = {
  id: String,
  currentCount: Number,
  errors: [{ count: Number, id: String }],
  totalCount: Number
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
  },
  uploadStatus: uploadStatus
});

module.exports = mongoose.model('sheet', sheetSchema);

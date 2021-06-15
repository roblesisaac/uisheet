const mongoose = require('mongoose');

var siteSchema = new mongoose.Schema({
  name: { type: String, unique: true },
  clone: String,
  htmlButton: String,
  author: String,
  scripts: [
    { name: String, text: String }  
  ],
  cacheStamp: String
});

module.exports = mongoose.model('site', siteSchema);

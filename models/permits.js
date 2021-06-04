const mongoose = require('mongoose');
const rule = {
  add: Array, // add this[propName] to query
  remove: Array // removes this[propName] from query
}
const rules = {
    get: rule,
    put: rule,
    post: rule,
    delete: rule
}

var permitSchema = new mongoose.Schema({
  username: String,
  sheetId: String,
  siteId: String,
  db: {
    methods: Array,
    rules: rules
  },
  ui: {
    apps: Array,
    rules: rules
  },
  permit: {
    methods: Array,
    rules: rules
  }
});

module.exports = mongoose.model('permit', permitSchema);


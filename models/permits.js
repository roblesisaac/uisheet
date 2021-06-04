const mongoose = require('mongoose');
const rules = {
    get: {
      add: Array, // add this[propName] to query
      remove: Array // removes this[propName] from query
    },
    put: {
      add: Array,
      remove: Array
    },
    post: {
      add: Array,
      remove: Array
    },
    delete: {
      add: Array,
      remove: Array
    }
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


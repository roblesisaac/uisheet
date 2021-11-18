const mongoose = require("mongoose");
const AccountSchema = new mongoose.Schema({
  userId: {
    type: String,
    required: true
  },
  institutionId: {
    type: String,
    required: true
  },
  userId: {
    type: String,
    required: true
  },
  siteId: {
    type: String,
    required: true
  }
});
module.exports = Account = mongoose.model("account", AccountSchema);

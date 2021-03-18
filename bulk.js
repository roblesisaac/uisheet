const Chain = require("./scripts/chain");
const mongoose = require("mongoose");
var models = {
  sheets: require("./models/sheets"),
  sites: require("./models/sites"), 
  users: require("./models/users")
};

module.exports.bulk = function(event, context, callback) {
  var initBulk = new Chain({
    steps: {
      connectToMongo: function() {
        var self = this,
            options = {
              useCreateIndex: true,
              autoIndex: true
            };
        mongoose.connect(process.env.DB, options).then(function(database){
          self.next();
        });
      },
      postBulkItems: function() {
        var newSheet = {
              name: "bulkCreated",
              siteId:"5d040cd9d1e17100079b8500"
            };
        models.sheets.create(newSheet, function(err, data){
          if(err) {
            console.log(err);
          } else {
            
          }
        });
      }
    },
    instruct: [
      "connectToMongo",
      "postBulkItems" 
    ]
  }).start();
};

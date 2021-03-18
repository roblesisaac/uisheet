const Chain = require("./scripts/chain");
const mongoose = require("mongoose");
var models = {
  sheets: require("./models/sheets")
};

module.exports.bulk = function(event, context, callback) {
  context.callbackWaitsForEmptyEventLoop = false;
  var initBulk = new Chain({
    steps: {
      connectToMongo: function() {
        var self = this;
        mongoose.connect(process.env.DB).then(function(database){
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
            callback(null, {
        		  headers:{
        		    "Access-Control-Allow-Origin": "*",
        		    "Cache-Control": "no-cache",
        		    // "Cache-Control": "max-age=31536000"
        		  },
              statusCode: 200,
              body: JSON.stringify({message: "Error there was"})            
            });
          } else {
            callback(null, {
        		  headers:{
        		    "Access-Control-Allow-Origin": "*",
        		    "Cache-Control": "no-cache",
        		    // "Cache-Control": "max-age=31536000"
        		  },
              statusCode: 200,
              body: JSON.stringify(data)
            });
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

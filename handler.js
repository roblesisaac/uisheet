"use strict";

try {
const AWS = require("aws-sdk");
const braintree = require("braintree");
const busboy = require("busboy");
const s3 = new AWS.S3();
const mime = require("mime");
const Utils = require("./scripts/utils");
const Chain = require("./scripts/chain");
var models = {
  sheets: require("./models/sheets"),
  sites: require("./models/sites"), 
  users: require("./models/users")
};
const permits = require("./models/permits");
const lambda = new AWS.Lambda({ region: "us-west-1" });
const mongoose = require("mongoose");
const cookie = require("cookie");
let isConnected;
const emptySheet = require("./utils/emptySheet");
const emptyPermit = require("./utils/emptyPermit");
const fs = require("fs");
let favicon;
const nodeFetch = require("node-fetch").default;
const Phaxio = require('phaxio-official');
const scripts = {};
if(!scripts.index) {
  fs.readdir("./scripts", function (err, data) {
    if(err) return err;
    for (var i=0; i<data.length; i++) {
      var fileName = data[i],
          templateName = data[i].split(".")[0],
          fileType = data[i].split(".")[1],
          text = fs.readFileSync("./scripts/" + fileName, "utf8");
      scripts[fileName] = text;
      if(fileType == "html") scripts[templateName] = text;
    }
  });
}
const jwt = require("jsonwebtoken");
const loop = function(arr) {
  return { async: arr };
};
const render = require("./render");
const ssClient = require("smartsheet");

global.auth = new Chain({
  steps: {
    lookupAuth: function() {
      var AuthenticationClient = require("auth0");
      this.next({
        hello: "HI",
        type: typeof AuthenticationClient,
        keys: Object.keys(AuthenticationClient)
      });
    }
  },
  instruct: [
    "lookupAuth"  
  ]
});
global.braintree = new Chain({
  input: function() {
    return {
      brainMethod: this._arg1
    };
  },
  steps: {
    buildPaymentObj: function() {
      var payload = this._body,
          payment = {},
          validProps = [
            "amount",
            "paymentMethodNonce",
            "customer",
            "billing",
            "deviceData",
            "shipping",
            "options",
            "customerId"
          ],
          replace = {
            nonce: "paymentMethodNonce"
          };
          
      for(var prop in payload) {
        if(validProps.includes(prop)) {
          payment[prop] = payload[prop];
        } else if(replace[prop]) {
          payment[replace[prop]] = payload[prop];
        }
      }
      
      this.payment = payment;
      this.next();
    },
    chargeCard: function() {
      var self = this;
      this.gateway.transaction.sale(this.payment, function (err, result) {
        if (result) {
          self.next(result);
        } else {
          self.error(err);
        }
      });
    },
    clientToken: function() {
      var self = this;
      this.gateway.clientToken.generate(this._body, function (err, response) {
        self.next({
          token: response.clientToken
        });
      });  
    },
    fetchCustomer: function() {
      var self = this;
      this._body.customer = this._body.customer || {};
      this.gateway.customer.find(this._body.customerId, function(err, customer) {
        self.next(customer || {id: false});
      });
    },
    initGateway: function() {
      this.gateway = braintree.connect({
        environment: braintree.Environment.Sandbox,
        merchantId: process.env.BTMERCHANTID,
        publicKey: process.env.BTPUBLIC,
        privateKey: process.env.BTPRIVATE
      });
      this.next();
    },
    saveCustomer: function() {
      var self = this,
          customer = this._body.customer;
      this.gateway.customer.create(customer, function (err, result) {
        if(err) {
          self.error(err);
          return;
        }
        self.next(result);
      });
    },
    toBrainMethod: function() {
      this.next(this.brainMethod || "getClientToken");
    }
  },
  instruct: [
    "initGateway",
    {
      switch: "toBrainMethod",
      getCustomer: "fetchCustomer",
      getClientToken: "clientToken",
      charge: [
        "buildPaymentObj",
        "chargeCard"  
      ]
    }
  ]
});
global.checkEmailVerified = new Chain({
  steps: {
    alertVerificationEmailSent: function() {
      var resendUrl = this._host+"/resendVerification";
      this.error("<(-_-)> Oops, unverified "+this.user.email+" still is. Check email, you must. <br/> Didn't get it? <a href='"+resendUrl+"'>Click To Resend »</a>");
    },
    deleteAccount: function() {
      var self = this;
      models.users.findByIdAndRemove(this.user.id, function(err, data){
        if(err) return self.error(err);
        self.error("<(-_-)> No longer in archives, "+ self.user.username+" is");
      }); 
    },
    emailNotVerifiedYet: function() {
      if(!this.user) return this.error("<(-_-)> Missing user, you are.");
      if(this.user.status == "verified" || this.user.username=="public") return this.next(false);
      
      var dateFromObjectId = function (objectId) {
          	return new Date(parseInt(objectId.substring(0, 8), 16) * 1000);
          },
          createdOn = dateFromObjectId(this.user.id),
          rightNow = Date.now(),
          secondsSinceCreated = rightNow-createdOn,
          aMinute = 1000*60,
          anHour = aMinute*60,
          aDay = anHour*24;
          
      this.next(secondsSinceCreated>=aDay);
    }
  },
  instruct: {
    if: "emailNotVerifiedYet",
    true: [
      // "sendConfirmationEmail",
      "alertVerificationEmailSent"
    ]
  }
});
global.checkPermit = new Chain({
  steps: {
    alertPermitExcludesMethod: function() {
      this.error("<(-_-)> Method is prohibited, your permit declares.");
    },
    permitExcludesMethodForProp: function() {
      var prop = this._chain == "db" ? "db" : "permit";
      this.next(this.permit[prop].methods.indexOf(this._eventMethod) == -1);
    }
  },
  instruct: [
    "getUserPermitForSheet",
    { if: "permitExcludesMethodForProp", true: "alertPermitExcludesMethod" }
  ]
});
global.connectToDb = new Chain({
  steps: {
    alreadyConnected: function() {
      this.next(!!isConnected);
    },
    connect: function() {
      var self = this,
          options = {
            useCreateIndex: true,
            autoIndex: true,
            keepAlive: true
          };
      mongoose.connect(process.env.DB, options).then(function(database){
        isConnected = database.connections[0].readyState;
        self.next();
      });
    },
    promiseResolve: function() {
      Promise.resolve();
      this.next();
    }
  },
  instruct: {
    if: "alreadyConnected",
    true: "promiseResolve",
    false: "connect"
  }
});
global.cookie = new Chain({
  instruct: [function() {
    this.end(this._cookies);
  }]
}); // remove
global.db = new Chain({
  input: function() {
    return {
      id: this._arg2,
      filter: {},
      nativeOptions: {
        limit: Number,
        tailable: null,
        sort: String,
        skip: Number,
        maxscan: null,
        batchSize: null,
        comment: String,
        snapshot: null,
        readPreference: null,
        hint: Object,
        select: String
      },
      options: {
        limit: 50
      },
      sheetName: this._arg1
    };
  },
  steps: {
    addFilter: function() {
      this.pipeline.push({ $match: this.filter });
      this.next();
    },
    addSelectedProps: function() {
      if(this.optionKeys.includes("select")) {
        var select = this.options.select.split(" "),
            self = this;
        select.forEach(function(sProp){
          self.$group[sProp] = { $first: "$"+sProp };
        });
        this.pipeline.push({$group: this.$group});
      } else {
        this.$group.doc = {"$first":"$$ROOT"};
        this.pipeline = this.pipeline.concat([{ "$group": this.$group },{"$replaceRoot":{"newRoot":"$doc"}}]);
      }
      
      this.next();
    },
    addSort: function() {
      if(this.optionKeys.includes("sort")) {
        var sort = this.options.sort,
            isNegative = sort.includes("-"),
            sortObj = {};
        
        if(isNegative) {
          sort.replace("-", "");
          sortObj[sort] = -1;
        } else {
          sortObj[sort] = 1;
        }
        
        this.pipeline.push({ $sort : sortObj });
      }
      
      this.next();
    },
    addSkip: function() {
      if(this.optionKeys.includes("skip")) {
        this.pipeline.push({ $skip : this.options.skip });
      }
      this.next();
    },
    addLimit: function() {
      this.pipeline.push({ "$limit": this.options.limit });
      this.next();
    },
    addAuthorToBody: function() {
      this._body.author = this.user._id;
      this.next();
    },
    addSiteIdToBody: function () {
      this._body.siteId = this.siteId;
      this.next();
    },
    addSiteIdToFilter: function(res, next) {
      this.filter.siteId = this.siteId;
      next();
    },
    addToOptions: function() {
      this.options[this.key] = this.nativeOptions[this.key](this.value);
      this.next();
    },
    addToFilter: function() {
      this.filter[this.key] = this.value;
      this.next();
    },
    alertNeedPermissionFromAuthor: function() {
      this.error("<(-_-)> Permission from site author, you must have.");
    },
    bulkImport: function() {
      // var contentType = this._headers["Content-Type"] || this._headers["content-type"],
      //     bb = new busboy({ headers: { "content-type": contentType }}),
      //     self = this;
      
      // // this.next({
      // //   message: "hi"
      // // });
      
      // bb.on("file", function (fieldname, file, filename, encoding, mimetype) {
      //   file
      //   .on("data", function(data) {
      //     self.next("data");
      //   })
      //   .on("end", function() {
      //     // self.next("end");
      //   });
      // })
      // .on("field", function(fieldname, val) {
      //   // self.next("field");
      // })
      // .on("finish", function () {
      //   // self.next("finish");
      // })
      // .on("error", function(err) {
      //   // self.error(err);
      // });
    
      // bb.end(self._body);
      
      var self = this;
      
      lambda.invoke({
        FunctionName: "uisheet-dev-bulk",
        Payload: JSON.stringify(self._event),
        InvocationType: "Event"
      }, function(error, response) {
        self.next({
          message: "<(-_-)> Uploading " + self._body.length + " items, you are.",
          response: response,
          error: error
        });
      });

    },
    bulkImportCompleted: function() {
      this.next("<(-_-)> Imported " + this._body.length + " items to " + this.sheetName + ", you have.");
    },
    convertToOr: function() {
      var ors = this.value.split(","),
          key = this.key;
      
      var $ors = ors.map(function(or) {
        var obj = {};
        obj[key] = or;
        return obj;
      });
      
      if(this.filter.$or) {
        this.filter.$or = this.filter.$or.concat($ors);
      } else {
        this.filter.$or = $ors;
      }
      
      this.next();
    },
    convertToRegex: function() {
      this.value = this.value.replace(/\//g,"");
      this.value = { $regex: new RegExp(this.value) };
      this.next();
    },
    createSheetForNewSite: function(newSite) {
      var siteSheet = emptySheet("sheets", newSite._id, this.user._id),
          self = this;
          
      models.sheets.create(siteSheet, function(err, newSheet){
        if(err) return self.error(err);
        self.newSheet = newSheet;
        self.next();
      });
    },
    createPermitForNewSite: function(newSite) {
      var sitePermit = emptyPermit(this.newSheet._id, newSite._id, this.user.username),
          self = this;
      permits.create(sitePermit, function(err, newPermit) {
        if(err) return self.error(err);
        self.next({
          newPermit: newPermit,
          newSheet: self.newSheet,
          newSite: newSite
        });
      });
    },
    createPermitForSheet: function (sheet) {
      var sitePermit = emptyPermit(sheet._id, this.siteId, this.user.username),
          self = this;
      permits.create(sitePermit, function(err, newPermit) {
        if(err) return self.error(err);
        self.next({
          newPermit: newPermit,
          newSheet: self.newSheet
        });
      });
    },
    deleteItem: function() {
      if(!this.id) return this.error("<(-_-)> ID, every delete must have.");
      var self = this;
      this.model.findByIdAndRemove(this.id, function(err, data){
        if(err) return self.error(err);
        self.next(data);
      }); 
    },
    deleteSheet: function() {
      var self = this;
      models.sheets.findByIdAndRemove(this.item._id, function(err, data){
        if(err) return self.error(err);
        self.next(data);
      });   
    },
    dropDb: function() {
      var dbName = this._query.dbName,
          self = this;
      if(dbName==this.sheetName) {
        delete this._query.dbName;
        this.model.remove(this._query, function(err) {
          if(err) return self.error(err);
          self.next("<(-_-)> Wiped clean, your db is.");
        }); 
      } else {
        this.next("<(-_-)> Not matching your db " + dbName + "  name is.");
      }
    },
    droppingDb: function() {
      this.next(this.id==="drop");
    },
    forEachSheetInSite: function() {
      var self = this;
      models.sheets.find({
        siteId: this.id
      }, function(err, sheets){
        if(err) return self.error(err);
        self.next(sheets);
      });  
    },
    forEachPermitInSite: function() {
      var self = this;
      permits.find({
        siteId: this.id
      }, function(err, permits){
        if(err) return self.error(err);
        self.next(permits);
      });
    },
    findById: function(res, next) {
      var self = this;
      this.model.findById(this.id, null, this.options, function(err, item) {
        if(err) return self.error(err);
        next(item);
      });
    },
    forEachQueryKey: function() {
      this.next(this._query);
    },
    getAllItems: function() {
      var self = this;
      this.model.find(this.filter, null, this.options, function(err, data){
        if(err) return self.error(err);
        self.next(data);
      });
    },
    getDistinctItems: function() {
      var self = this;
      this.model.aggregate(this.pipeline, function(err, data) {
        if(err) return self.error(err);
        self.next(data);
      });
    },
    getCount: function() {
      var self = this;
      this.model.countDocuments(this.filter, function(err, count){
        if(err) return self.error(err);
        self.next(count);
      });
    },
    hasNewPassword: function() {
      this.next(!!this._body.newPassword);
    },
    hasSpecialCaveates: function () {
      var caveats = ["sites", "users"];
      this.next(caveats.indexOf(this.sheetName)>-1);
    },
    hasId: function(res, next) {
      next(!!this.id);
    },
    isANativeOption: function() {
      this.next(Object.keys(this.nativeOptions).indexOf(this.key) > -1);
    },
    isDbCount: function() {
      this.next(this.id=="count" || this.id == "length");
    },
    isDistinct: function() {
      this.next(!!this.filter._distinct);
    },
    isUpdateMany: function () {
      this.next(this.id=="many");
    },
    lookupSiteAuthor: function () {
      var self = this;
      models.sites.findById(this.id, function(err, site){
        if(err) return self.error(err);
        self.next(site.author);
      });
    },
    moreThanOneItem: function() {
      this.next(Array.isArray(this._body));
    },
    needsASiteId: function(res, next) {
      next(this.sheetName == "sheets");
    },
    postItem: function() {
      var self = this;
      this.model.create(this._body, function(err, data){
        if(err) return self.error(err);
        self.next(data);
      });
    },
    prepPipelineWithDistinct: function() {
      this.pipeline = [];
      this.$group = { "_id": "$"+this.filter._distinct };
      this.optionKeys = Object.keys(this.options);
      
      delete this.filter._distinct;
      this.next();
    },
    removePassword: function() {
      delete this._body.password;
      this.next();
    },
    setNewPassword: function() {
      var self = this;
      this.user.hashPassword(this._body.newPassword, function(hashed){
        self.user.password = hashed;
        self._body = self.user;
        self.next();
      });
    },
    toCaveats: function() {
      this.next(this.sheetName);
    },
    toRouteMethod: function(res, next) {
      next(this._eventMethod);
    },
    updateItem: function() {
      if(!this.id) return this.error("<(-_-)> ID, every update must have.");
      var self = this;
      this.model.findByIdAndUpdate(this.id, this._body, { new: true }, function(err, data){
        if(err) return self.error(err);
        self.next(data);
      });
    },
    updateMany: function() {
      var filter = this._body.filter,
          update = this._body.update,
          self = this;
      this.model.update(filter, {"$set":update}, {"multi": true}, function(err, data) {
        if(err) return self.error(err);
        self.next(data);
      });  
    },
    userIsAuthorOfSite: function(author) {
      this.next(this.user._id.toString() == author);
    },
    valueIsRegex: function() {
      var firstIsSlash = this.value.charAt(0) == "/",
          lastIsSlash = this.value.charAt(this.value.length-1) == "/";
      this.next(firstIsSlash && lastIsSlash);
    },
    valueHasPlusCommas: function() {
      var isString = typeof this.value == "string";
      this.next(this.value && isString && this.value.indexOf(",")>-1);
    }
  },
  instruct: [
    "checkEmailVerified",
    "checkPermit",
    "model",
    {
      switch: "toRouteMethod",
      get: [
        "forEachQueryKey", [
          {
            if: "isANativeOption",
            true: "addToOptions",
            false: [
              { if: "valueIsRegex", true: "convertToRegex" },
              { 
                if: "valueHasPlusCommas",
                true: "convertToOr",
                false: "addToFilter"
              }
            ]
          }  
        ],
        { if: "isDbCount", true: ["getCount", "serve"] },
        {
          if: "hasId",
          true: "findById",
          false: [
            { if: "needsASiteId", true: "addSiteIdToFilter" },
            {
              if: "hasSpecialCaveates",
              true: { 
                switch: "toCaveats",
                sites: "getAllUserSites"
              },
              false: {
                if: "isDistinct",
                true: [
                  "prepPipelineWithDistinct",
                  "addFilter",
                  "addSelectedProps",
                  "addSort",
                  "addSkip",
                  "addLimit",
                  "getDistinctItems"
                ],
                false: "getAllItems"
              }
            }
          ]
        }
      ],
      put: {
        if: "hasSpecialCaveates",
        true: {
          switch: "toCaveats",
          sites: [
            "lookupSiteAuthor",
            {
              if: "userIsAuthorOfSite",
              true: "updateItem",
              false: "alertNeedPermissionFromAuthor"
            }  
          ],
          users: [
            "lookupUser",
            {
              if: "userDoesntExist",
              true: "alertUserDoesntExist",
              false: {
                if: "passwordAuthenticates",
                true: { 
                  if: "hasNewPassword",
                  true: ["setNewPassword", "updateItem", "createCookies", "sendCredentials"],
                  false: ["removePassword", "updateItem"]
                },
                false: "alertPasswordsDontMatch"
              }
            }
          ]
        },
        false: {
          if: "isUpdateMany",
          true: "updateMany",
          false: "updateItem"
        }
      },
      post: [
        { 
          switch: "toCaveats",
          sites: "addAuthorToBody",
          sheets: ["addAuthorToBody", "addSiteIdToBody" ]
        },
        {
          if: "moreThanOneItem",
          true: "bulkImport",
          false: [
            "postItem",
            {
              switch: "toCaveats",
              sites: [ "createSheetForNewSite", "createPermitForNewSite" ],
              sheets: [ "createPermitForSheet" ]
            }
          ]
        }
      ],
      delete: {
        if: "hasSpecialCaveates",
        true: {
          switch: "toCaveats",
          sites: [
            "lookupSiteAuthor",
            {
              if: "userIsAuthorOfSite",
              true: [
                "deleteItem",
                "forEachSheetInSite", loop(["deleteSheet"]),
                "forEachPermitInSite", loop(["deletePermit"])
              ],
              false: "alertNeedPermissionFromAuthor"
            }  
          ]
        },
        false:  {
          if: "droppingDb",
          true: "dropDb",
          false: "deleteItem"
        }
      }
    }
  ]
});
global.fax = new Chain({
  steps: {
    createFax: function() {
      this.phaxio  = new Phaxio(process.env.PHAXIOKEY, process.env.PHAXIOSECRET);
      var self = this;
      this.phaxio.faxes.create({
        to: self._body.to,
        content_url: self._body.content
      }).then(function(fax) {
        self.fax = fax;
        self.next(fax);
      }).catch(function(err){
        self.error(err);
      });
    },
    getFaxInfo: function() {
      this.next({
        message: "Here is your fax",
        info: this.fax
      });
    }
  },
  instruct: {
    switch: "toRouteMethod",
    post: [
      "createFax",
      "getFaxInfo"
    ]
  }
});
global.fetch = new Chain({
  input: function() {
    return {
      fetchBody: this._body.body,
      method: this._body.method || "GET",
      options: {
        method: this._body.method || "GET",
        headers: { "Content-Type": "application/json" }
      },
      url: this._body.url
    };
  },
  steps: {
    addBodyToFetch: function() {
      this.options.body = JSON.stringify(this.fetchBody);
      this.next();
    },
    addParamsToUrl: function() {
      for(var key in this.fetchBody) {
        this.url += (key+"="+this.fetchBody[key]+"&");
      }
      this.next();
    },
    fetchHasBody: function() {
      this.next(!!this.fetchBody);
    },
    fetchUrl: function() {
      var self = this;
      nodeFetch(this.url, this.options).then(function(res){
        res.json().then(function(json){
          self.next(json);
        });
      }).catch(function(e){
        self.error(e);
      });
    },
    makeSureUrlEndsWithQuestion: function() {
      if(this.url.excludes("?")) this.url += "?";
      this.next();
    },
    toFetchMethod: function() {
      this.next(this.method.toLowerCase());
    }
  },
  instruct: [
    {
      switch: "toFetchMethod",
      get: {
        if: "fetchHasBody", 
        true: [
          "makeSureUrlEndsWithQuestion",
          "addParamsToUrl"
        ]
      },
      post: { if: "fetchHasBody", true: "addBodyToFetch" }
    },
    "fetchUrl"  
  ]
});
global.getAllUserSites = new Chain({
  input: {
    userSites: []
  },
  steps: {
    appendToUserSites: function(userSite) {
      this.userSites.push(userSite);
      this.next();
    },
    getAllPermitsForUser: function() {
      var self = this;
      this.userPermits = [];
      permits.find({
        username: this.user.username
      }, function(err, permits){
        if(err) return self.error(err);
        self.userPermits = permits;
        self.next();
      });
    },
    getUniqueSiteIds: function() {
      var uniqueSiteIds = [];
      for(var i=0; i<this.userPermits.length; i++) {
        var permit = this.userPermits[i];
        if(uniqueSiteIds.indexOf(permit.siteId) == -1) {
          uniqueSiteIds.push(permit.siteId);
        }
      }
      this.next(uniqueSiteIds);
    },
    getUserSite: function() {
      var self = this;
      models.sites.findById(this.userSiteId, function(err, userSite) {
        if(err) return self.error(err);
        self.next(userSite, "userSite");
      });
    }
  },
  instruct: [
    "getAllPermitsForUser",
    "getUniqueSiteIds", loop([
      "define=>userSiteId",
      "getUserSite",
      "appendToUserSites"
    ]),
    function() {
      this.next(this.userSites);
    }
  ]
});
global._fetchSheetForEachPermit = new Chain({
  input: {
    sheets: []
  },
  steps: {
    appendToSheets: function(sheet) { 
      if(sheet) this.sheets.push(sheet);
      this.next();
    },
    grabUserPermitsForSite: function() {
      this.next(this.permits);
    },
    fetchCorrespondingSheet: function() {
      var self = this;
      models.sheets.findById(this.permit.sheetId, function(err, sheet){
        if(err) return self.error(err);
        self.next(sheet);
      });
    },
    fetchSheetsForUserPermits: function() {
      var self = this,
          _ids = this.permits.map(function(permit) {
            return permit.sheetId;
          });
      models.sheets.find({
        _id: { $in: _ids }
      }, function(err, resSheets){
        if(err) return self.error(err);
        self.sheets = resSheets;
        self.next();
      });
    },
    userHasAccessToSheet: function() {
      // var isAll = this.permit.ui.apps.indexOf("all") > -1,
      //     isHtml = this.permit.ui.apps.indexOf("ui") > -1;
      // this.next(isAll || isHtml);
      this.next(true);
    },
    sortSheets: function() {
      this.sheets.sortByProp("sort");
      this.next();
    }
  },
  instruct: [
    "grabUserPermitsForSite",
    // "fetchSheetsForUserPermits",
    loop([ "define=>permit",
      {
        if: "userHasAccessToSheet",
        true: [
          "fetchCorrespondingSheet",
          "appendToSheets"
        ]
      }
    ]),
    "sortSheets"
  ]
});
global.getUserPermitForSheet = new Chain({
  input: function() {
    return {
      sheetName: this._arg1 || "sheets",
      id: this._arg2,
      sheet: {}
    };
  },
  steps: {
    alertNoPermitExists: function() {
      this.error("<(-_-)> Not found in archives, your permit is.");
    },
    fetchPublicPermit: function() {
      var self = this,
          filters = {
            siteId: this.siteId,
            username: "public",
            sheetId: this.sheet._id,
          };
      permits.findOne(filters, function(error, permit) {
        if(error) return self.error(error);
        self.permit = permit;
        self.next();
      });      
    },
    fetchPermit: function() {
      var self = this,
          filters = {
            siteId: this.siteId,
            username: this.user.username,
            sheetId: this.sheet._id,
          };
      permits.findOne(filters, function(error, permit) {
        if(error) return self.error(error);
        self.permit = permit;
        self.next();
      });
    },
    grabPermit: function() {
      this.permit = this.permits.findOne({
        sheetId: this.sheet._id.toString()
      });
      this.next();
    },
    noPermitExists: function() {
      this.next(!this.permit);
    },
    sendDefaultPermit: function() {
      this.permit = {
        db: {
          methods: ["get","put","post","delete"]
        },
        ui: {
          apps: ["all"]
        },
        permit: {
          methods: ["get","put","post","delete"]
        },
        username: this.user.username,
        siteId: this.siteObj._id
      };
      this.next();
    },
    siteIsUisheetOrSheetIsUser: function() {
      this.next(this.siteObj.name == "uisheet" || this.sheetName=="users");
    }
  },
  instruct: {
    if: "siteIsUisheetOrSheetIsUser",
    true: "sendDefaultPermit",
    false: [
      "grabSheet",
      
      "grabPermit",
      
      // "fetchPermit",
      { 
        if: "noPermitExists", 
        true: [
          "fetchPublicPermit",
          { if: "noPermitExists", true: "alertNoPermitExists" }
        ]
      } 
    ]
  }
});
global.images = new Chain({
  input: function() {
    return {
      buckets: [],
      name: this._arg1
    };
  },
  steps: {
    createPresignedPost: function () {
      var self = this,
          name = this._body.name,
          params = {
            Expires: 60,
            Bucket: process.env.BUCKET,
            Conditions: [["content-length-range", 100, 10000000]], // 100Byte - 10MB
            Fields: {
              ACL: "public-read",
              "Content-Type": mime.getType(name),
              key: this._siteName + "/" + name
            }
          };
          
      s3.createPresignedPost(params, function(err, data) {
        if(err) return self.error(err);
        self.next(data);
      });
    },
    getS3Object: function() {
      var self = this;
      s3.getObject({
        Bucket: process.env.BUCKET,
        Key: this._siteName + "/" + this.name
      }, function(err, data){
        if(err) return self.error(err);
        self.s3Obj = data;
        self.next(data);
      });
    },
    isDataRequest: function() {
      this.next(!!this._query.data);
    },
    isOneImage: function() {
      this.next(!!this.name);
    },
    listAll: function() {
      var params = this._query,
          self = this;
      params.Bucket = process.env.BUCKET;
      params.Prefix = params.Prefix || this._siteName + "/";
      s3.listObjects(params, function(err, data) {
        if (err) self.error(err);
        self.next(data.Contents);
      });
    },
    renderImage: function(data) {
      var proper = require("./utils/proper");
      this.next({
  			headers: {
  			  "Content-Type": this.s3Obj.ContentType,
        	"Access-Control-Allow-Origin" : "*",
        	"Access-Control-Allow-Credentials" : true
  			},
        statusCode: 200,
  			body: this.s3Obj.Body.toString("base64"),
        isBase64Encoded: true
      });
    },
    sendImageData: function(data) {
      var type = this.s3Obj.Body.type;
      delete this.s3Obj.Body;
      this.s3Obj.type = type;
      this.next(this.s3Obj);
    }
  },
  instruct: {
    switch: "toRouteMethod",
    get: {
      if: "isOneImage",
      true: [
        "getS3Object",
        {
          if: "isDataRequest",
          true: "sendImageData",
          false: "renderImage"
        }
      ],
      false: "listAll"
    },
    post: "createPresignedPost"
  }
});
global.grabSheet = new Chain({
  input: function() {
    return {
      sheetName: this._arg1
    };
  },
  steps: {
    alertNoSheetFound: function() {
      this.error("Not existing in archives, sheet " + this.sheetName + " is. Or enter you will, when permit you have.");
    },
    lookupAndDefineSheet: function() {
      var self = this;
      this.sheet = this.sheets.findOne({
        name: self.sheetName
      });
      this.next(this.sheet);
    },
    noSheetFound: function() {
      this.next(this.sheet === null);  
    }
  },
  instruct: [
    "lookupAndDefineSheet",
    {
      if: "noSheetFound",
      true: "alertNoSheetFound"
    }    
  ]
});
global._loadMasterSite = new Chain({
  input: {
    masterSite: false,
  },
  steps: {
    loadMasterSite: function() {
      var self = this;
      models.sites.findOne({ name: "uisheet" }, function(err, masterSite){
        if(err) return self.next(err);
        self.masterSite = masterSite;
        self.next();
      });
    },
    masterSiteNotLoaded: function() {
      this.next(!this.masterSite);
    }
  },
  instruct: { if: "masterSiteNotLoaded", true: "loadMasterSite" }
});
global.login = new Chain({
  steps: {
    alertPasswordsDontMatch: function(res) {
      this.error("<(-_-)> Unjust password, this is.");
    },
    alertUserDoesntExist: function() {
      this.error("<(-_-)> Not existing in archives user, "+ this._body.username +" is.");
    },
    createCookies: function() {
      var tokenContent = {
    		    _id: this.user._id,
    		    username: this.user.username,
    		    password: this.user.password
          },
          cookieOptions = { secure: true, sameSite: true, httpOnly: true, maxAge: 60*60*10, path: "/" },
      		secret = this.user.password;
      this.token = jwt.sign(tokenContent, secret, {	expiresIn: "10h" });
      this.cookieToken = cookie.serialize("token", String(this.token), cookieOptions);
      this.cookieUserId = cookie.serialize("userid", String(this.user._id), cookieOptions);
      this.next();
    },
    lookupUser: function() {
      var self = this;
      models.users.findOne({username: this._body.username}, function(err, user){
        if(err) return self.error(err);
        self.user = user;
        self.next(user);
      });
    },
    passwordAuthenticates: function(user) {
      var self = this;
			user.comparePassword(this._body.password, function(err, isMatch) {
			 err ? self.error(err) : self.next(!!isMatch && isMatch === true);
			});  
    },
    sendCredentials: function() {
      var self = this;
      this.next({
        statusCode: 200,
  			body: {
  			    domain: this._domain,
  			    user: this.user
  			},
  			headers: {
        	"Access-Control-Allow-Origin" : "*",
        	"Access-Control-Allow-Credentials" : true
  			},
  			multiValueHeaders: {
          "Set-Cookie": [ this.cookieToken, this.cookieUserId ]
  			}
  		});
    },
    userDoesntExist: function(user) {
      this.next(!user);
    }
  },
  instruct: [
    "lookupUser",
    {
      if: "userDoesntExist",
      true: "alertUserDoesntExist",
      false: {
        if: "passwordAuthenticates",
        true: [
          "createCookies",
          "sendCredentials"
        ],
        false: "alertPasswordsDontMatch"
      }
    }
  ]
});
global.logout = new Chain({
  steps: {
    createLogoutCookies: function() {
      var cookieOptions = { secure: true, sameSite: "strict", httpOnly: true, maxAge: 0, path: "/" };
      this.cookieToken = cookie.serialize("token", "", cookieOptions);
      this.cookieUserId = cookie.serialize("userid", "", cookieOptions);
      this.next();     
    },
    sendLogout: function() {
      this.next({
        statusCode: 200,
  			body: {
  			    success: true,
  			    message: "<(-_-)> Logged out, you have become;"
  			},
  			headers: {
        	"Access-Control-Allow-Origin" : "*",
        	"Access-Control-Allow-Credentials" : true
  			},
  			multiValueHeaders: {
          "Set-Cookie": [ this.cookieToken, this.cookieUserId ]
  			}
  		});   
    }
  },
  instruct: [
    "createLogoutCookies",
    "sendLogout"
  ]
});
global.model = new Chain({
  input: function() {
    return {
      sheetName: this._arg1
    };
  },
  steps: {
    collectionExists: function() {
      this.modelIndex = mongoose.modelNames().indexOf(this.collectionName);
      this.next(this.modelIndex > -1);
    },
    createModel: function() {
      var options = {
        strict: true,
        collection: this.collectionName 
      };
      this.model = mongoose.model(this.collectionName, new mongoose.Schema(this.schema, options));
      this.next({
        name: this.collectionName,
        schema: this.stringSchema
      });
    },
    defineCollectionName: function() {
      this.collectionName = this.siteId+"_"+this.sheet._id;
      this.next();
    },
    relayModel: function() {
      this.model = mongoose.model(this.collectionName);
      this.next({
        collectionName: this.collectionName,
        index: this.modelIndex,
        schema: this.stringSchema,
        mongoose: {
          models: mongoose.modelNames(),
          version: mongoose.version
        }
      });  
    },
    relayNativeModel: function() {
      this.model = models[this.sheetName];
      this.next(this.model);
    },
    removeExistingModel: function() {
      delete mongoose.connection.models[this.collectionName];
      this.next();
    },
    schemaChanged: function() {
      var mSchema = mongoose.model(this.collectionName).schema.obj;
      this.next(!Object.matches(mSchema, this.schema));
    },
    sheetNameIsNative: function() {
      this.next(!!models[this.sheetName]);
    }
  },
  instruct: [
    "checkPermit",
    {
      if: "sheetNameIsNative",
      true: "relayNativeModel",
      false: [
        "grabSheet",
        "defineCollectionName",
        "schema",
        {
          if: "collectionExists",
          true: {
            if: "schemaChanged",
            true: ["removeExistingModel", "createModel"],
            false: "relayModel"
          },
          false: "createModel"
        }
      ]
    }
  ]
});
global.permits = new Chain({
  input: function() {
    return {
      sheetName: this._arg1 || "sheets",
      id: this._arg2
    };
  },
  steps: {
    alertNoUsernameSpecified: function() {
      this.error("<(-_-)> First specify a username for your permit, you must.");
    },
    alertPermitAlreadyExists: function() {
      this.error("<(-_-)> Already in archives, " + this._body.username + "'s permit is.");
    },
    deletePermit: function() {
      var self = this,
          id = this.item ? this.item._id : this.id;
      permits.findByIdAndRemove(id).then(function(deleted){
        self.next({
          message: "<(-_-)> Erased from archives, permit has become.",
          body: deleted
        });
      });
    },
    getPermits: function() {
      var self = this;
      permits.find({
        siteId: this.siteId,
        sheetId: this.sheet._id
      }, function(err, permits){
        if(err) return self.error(err);
        self.next(permits);
      });
    },
    noUsernameSpecified: function() {
      this.next(!this._body.username);
    },
    permitAlreadyExists: function() {
      var self = this;
      permits.findOne({
        username: this._body.username,
        siteId: this.siteId,
        sheetId: this.sheet._id
      }).then(function(permit){
        self.next(!!permit);
      });
    },
    postNewPermit: function() {
      var self = this,
          defaults = {
            methods: { methods: ["get", "put", "post", "delete"] },
            ui: { apps: ["all"] }
          },
          body = {
            username: this._body.username,
            siteId: this.siteId,
            sheetId: this.sheet._id,
            db: this._body.db || defaults.methods,
            ui: this._body.ui || defaults.ui,
            permit: this._body.permit || defaults.methods
          };
      permits.create(body, function(err, newPermit){
        if(err) return self.error(err);
        self.next(newPermit);
      });
    },
    updatePermit: function() {
      var self = this;
      permits.findByIdAndUpdate(this.id, this._body, { new: true }, function(err, updatedPermit){
        if(err) return self.error(err);
        self.next(updatedPermit);
      });
    }
  },
  instruct: [
    "checkPermit",
    {
      switch: "toRouteMethod",
      get: "getPermits",
      post: [
        "grabSheet",
        { if: "noUsernameSpecified", true: "alertNoUsernameSpecified" },
        { if: "permitAlreadyExists", true: "alertPermitAlreadyExists" },
        "postNewPermit"
      ],
      put: "updatePermit",
      delete: "deletePermit"
    }
  ]
});
global.renderUserLandingPage = new Chain({
  steps: {
    showIndex: function() {
      this.next({
        body: render("index", this),
        type: "text/html"
      });
    }
  },
  instruct: "showIndex"
});
global.renderUserLibrary = new Chain({
  steps: {
    renderLibrary: function() {
      this.next({
        body: render("library", this),
        type: "html"
      });
    }
  },
  instruct: "renderLibrary"
});
global.schema = new Chain({
  describe: "gets schema obj from sheeet, ready to convert into model",
  input: function() {
    return {
      sheetName: this._arg1,
      types: { 
        "string": String,
        "number": Number,
        "date": Date,
        "boolean": Boolean,
        "array": Array,
        "{}": Object,
        "lowercase": { type: String, lowercase: true },
        "obj": Object,
        "object": Object,
        "wild": Object
      }
    };
  },
  steps: {
    convertToFuncion: function() {
      if(!this.value) {
        this.obj[this.key] = String;
        this.stringSchema = "string";
        return;
      }
      var keyName = typeof this.value == "string"
                    ? this.value.toLowerCase()
                    : "string",
          convert = this.types[keyName];
      this.stringSchema[this.key] = keyName;
      this.obj[this.key] = convert || String;
      this.next();
    },
    forEachItemInSchema: function() {
      this.sheet.db = this.sheet.db || {};
      this.schema = this.sheet.db.schema || { noKeysDefined: "string"};
      this.stringSchema = Object.assign({}, this.schema);
      this.next(this.schema);
    }
  },
  instruct: [
    "checkPermit",
    "grabSheet",
    "forEachItemInSchema", ["convertToFuncion"],
    function() {
      this.next(this.stringSchema);
    }
  ]
});
global.scripts = new Chain({
  input: function() {
    return {
      data: {
        bucket: "https://"+process.env.BUCKET+".s3-us-west-1.amazonaws.com/"+this.siteObj.name,
        domain: this._domain,
        host: this._host,
        username: this.user.username      
      },
      addedScripts: [],
      minified: this._arg2,
      scripts: [],
      scriptType: this._arg1
    };
  },
  steps: {
    buildSheetScript: function() {
      this.sheetScript = "scripts."+this.sheet.name+"=function(){\n";
      for(var i=0; i<this.sheet.ui.scripts.length; i++) {
        var script = this.sheet.ui.scripts[i],
            name = script.name,
            type = name.split(".")[1] || "txt",
            matchesType = type.toLowerCase() == this.scriptType;
        if(matchesType) this.sheetScript+=("\n"+script.text);
      }
      this.sheetScript+="\n};";
      this.next();
    },
    forEachScriptFromUserSite: function() {
      this.next(this.siteObj.scripts);
    },
    forEachScriptFromMasterSite: function() {
      this.next(this.masterSite.scripts);
    },
    forEachSheetUserHasAccessTo: function() {
      this.next(this.sheets);
    },
    inLibrary: function() {
      this.next(this._siteName=="uisheet");
    },
    needsToBeAdded: function() {
      var scriptName = this.item.name,
          scriptType = scriptName.split(".")[1] || "txt",
          notARepeatScript = this.addedScripts.excludes(scriptName),
          matchesType = scriptType.toLowerCase() == this.scriptType,
          noUnderscores = scriptName.excludes("__");
          
      this.next(notARepeatScript && matchesType && noUnderscores);
    },
    notInLibrary: function() {
      this.next(this._siteName!=="uisheet");
    },
    pushGlobalFunctionToScripts: function() {
      this.scripts.push(`
      globalScript["${this.item.name}"] = function(){
        ${this.item.text}
      }`);
      this.next();
    },
    pushSheetFunctionToScripts: function() {
      this.scripts.push(this.sheetScript);  
    },
    pushToAddedScripts: function() {
      this.addedScripts.push(this.item.name);
      this.next();
    },
    pushToScripts: function() {
      this.scripts.push(this.item.text);
      this.next();
    },
    renderNativeScriptFromFile__: function() {
      this.fileType = this.scriptName.split(".")[1];
      this.end({
        body: scripts[this.scriptName],
        type: this.fileType,
        data: this.data
      }); 
    },
    renderDatas: function() {
      this.siteData = {
        name: this.siteObj.name,
        scripts: this.siteObj.scripts,
        url: this.siteObj.url
      };
      var self = this,
          dataNames = ["sheets", "permits", "siteData"],
          dataScripts = dataNames.map(function(dataName) {
            if(self[dataName]) {
              return `var ${dataName} = ${JSON.stringify(self[dataName])};`;
            }
          });
      this.end({
        body: dataScripts.join("\n"),
        type: "js",
        data: this.data
      });    
    },
    renderScripts: function() {
      var script = this.scripts.join("\n"),
          self = this;
          
      if(this.minified == "min") {
        var minify = require("terser").minify,
            minified = {},
            number = (this._query.number || 300)*1;
        for(var i=0; i<this.scripts.length; i++) {
          if(i!==number) minified[i] = this.scripts[i];
        }
        minify(minified).then(function(result){
          self.next(result.code);
        }).catch(function(e){
          self.next(e);
        });
        // minify(this.scripts[number]).then(function(result){
        //   self.next(result.code);
        // }).catch(function(e){
        //   self.next(e);
        // });
        // this.scripts.loop(function(i, scrpt, nx){
        //   if(i==27) return nx();
        //   minify(scrpt).then(function(result){
        //     minified[i] = result.code;
        //     nx();
        //   }).catch(function(e){
        //     minified[i+"ERROR"] = e;
        //     nx();
        //   });
        // }).then(function(){
        //   self.next(minified);
        // });
      } else {
        this.next({
          body: script,
          type: this.scriptType,
          data: this.data
        });
      }
    },
    toScriptType: function() {
      this.next(this.scriptType);
    }
  },
  instruct: [
    "_loadMasterSite",
    {
      switch: "toScriptType",
      data: "renderDatas",
      css: [
        "forEachScriptFromMasterSite", [
          { if: "needsToBeAdded", true: ["pushToScripts", "pushToAddedScripts"] }
        ],
        "renderScripts"
      ],
      js: [
        {
          if: "notInLibrary",
          true: [
            "forEachScriptFromUserSite", [
              {
                if: "needsToBeAdded",
                true: [ "pushGlobalFunctionToScripts", "pushToAddedScripts" ]
              }  
            ]
          ]
        },
        "forEachSheetUserHasAccessTo", [
          "define=>sheet",
          "buildSheetScript",
          "pushSheetFunctionToScripts",
          "pushToAddedScripts"  
        ], 
        "forEachScriptFromMasterSite", [
          { if: "needsToBeAdded", true: ["pushToScripts", "pushToAddedScripts"] }
        ],
        "renderScripts"
      ]
    }  
  ]
});
global.serve = new Chain({
  input: {
		types: {
			css: "text/css",
			html: "text/html",
			icon: "image/x-icon",
			js: "application/javascript",
			javascript: "application/javascript",
			script: "application/javascript",
			default: "application/javascript"
		},
		format: { 
		  headers:{
		    "Access-Control-Allow-Origin": "*",
		    "Cache-Control": "no-cache",
		    // "Cache-Control": "max-age=31536000"
		  },
		  statusCode: 200
		}
  },
  steps: {
    addContentTypeToHeaders: function(res) {
      this.format.headers["Content-Type"] = res.type || res["Content-Type"];
      this.next(res.body || "// <(-_-)> Empty, your body content is.");
    },
    addBodyToFormatObj: function(res) {
      this.format.body = res;
      this.next();
    },
    assignCustomHeadersObj: function(res) {
      this.format.headers = res.headers;
      this.next(res.body);
    },
    assignFullyCustomResponse: function(res) {
      this.format = res;
      this.next();
    },
    bodyIsNotString: function() {
      this.next(typeof this.format.body !== "string");
    },
    convertSimpleTypeToMimeType: function(res) {
    	var type = this.types[res.type] || res.type;
    	res.type = type || this.types.default;
    	this.next();
    },
    hasCustomHeadersObj: function(res) {
      this.next(!!res.headers);    
    },
    sendToClient: function() {
      this._callback(null, this.format);
    },
    isFullyCustom: function(res) {
      this.next(!!res.statusCode);
    },
    itDoesntHaveFormatting: function(res) {
      var hasId = res && !!res._id; // if it hasId it doesnt have formatting
      this.next(hasId || !res || (!res.type && !res.headers));
    },
    renderVariables: function(res) {
      for(var key in res.data) {
        if(!!res.data[key]) {
          var replacer = new RegExp("{{ "+key+" }}", "g"),
              replacement = res.data[key];
          if(typeof replacement !== "string") replacement = JSON.stringify(replacement);
					res.body = res.body.replace(replacer, replacement);  
        }
      }
      this.next(res);
    },
    stringifyBody: function() {
      this.format.body = JSON.stringify(this.format.body);
      this.next();
    },
    thereAreVariables: function(res) {
      this.next(!!res.data);
    }
  },
  instruct: [
  	{
  	  if: "itDoesntHaveFormatting",
  	  true: "addBodyToFormatObj",
  	  false: {
	      if: "isFullyCustom",
	      true: "assignFullyCustomResponse",
	      false: [
	        "convertSimpleTypeToMimeType",
	        { if: "thereAreVariables", true: "renderVariables" },
          {
    	      if: "hasCustomHeadersObj",
    	      true: "assignCustomHeadersObj",
    	      false: "addContentTypeToHeaders"
    	    },
    	    "addBodyToFormatObj"
        ]
	    }
  	},
    { if: "bodyIsNotString", true: "stringifyBody" },
  	"sendToClient"
  ]
});
global.signup = new Chain({
  input: function() {
    return {
      newUser: this._body
    };
  },
  steps: {
    addDefaultPropsToUser: function() {
      this.newUser.referral = this._siteName;
      this.newUser.params = this.newUser.params || {};
      this.newUser.status = this.verifyId;
      this.next();
    },
    errorNoBlanksAllowed: function() {
      this.error("<(-_-)> Fill in email and password, you must.");
    },
    makeUniqueVerifyId: function() {
      var result = "",
          characters = "abcdefghijklmnopqrstuvwxyz0123456789",
          charactersLength = characters.length;
      for ( var i = 0; i < 12; i++ ) {
        result += characters.charAt(Math.floor(Math.random() * charactersLength));
      }
      
      this.verifyId = result;
      this.next();
    },
    saveUserToDb: function() {
      var self = this;
      models.users.create(this.newUser, function(err, newUser){
        if(err) return self.error(err);
        self.newUser = newUser;
        self.next();
      });
    },
    requiredPropsAreBlank: function() {
      var thereIsABlank = false,
          requiredProps = ["password", "email"];
          
      for(var i=0; i<requiredProps.length; i++) {
        var prop = requiredProps[i];
        if(!thereIsABlank && this.newUser[prop] == "") {
          thereIsABlank = true;
        }
      }
      
      this.next(thereIsABlank);
    },
    sendConfirmationEmail: function() {
      this.user = this.newUser || this.user;
      var self = this,
          verifyToken = jwt.sign({ token: this.verifyId, userid: this.user.id }, process.env.VERIFY, {	expiresIn: "2d" });
          
      global.sib.start({
        _arg1: "email",
        _body: {
          email: "irobles1030@gmail.com",
          template: 1,
          params: {
            host: this._host,
            siteName: this._siteName,
            token: verifyToken,
            user: this.user
          }
        }
      });
          
      global.sib.start({
        _arg1: "email",
        _body: {
          email: this.user.email,
          template: 1,
          params: {
            host: this._host,
            siteName: this._siteName,
            token: verifyToken,
            user: this.user
          }
        }
      }).then(function(res){
        self.next("<(-_-)> Confirmation email at "+self.user.email+" you will find.");
      }).catch(function(e){
        self.error(e);
      });
    }
  },
  instruct: [
    { if: "requiredPropsAreBlank", true: "errorNoBlanksAllowed" },
    "makeUniqueVerifyId",
    "addDefaultPropsToUser",
    "saveUserToDb",
    "sendConfirmationEmail",
    "createCookies",
    "sendCredentials"
  ]
});
global.sib = new Chain({
  steps: {
    alertNeedNumber: function() {
      this.error("<(-_-)> Missing phone number, you are.");
    },
    alertNeedRecipient: function() {
      this.error("<(-_-)> Recipient for email, you must include");
    },
    BuildSibApi: function() {
      this.SibApiV3Sdk = require("sib-api-v3-sdk");
      this.defaultClient = this.SibApiV3Sdk.ApiClient.instance;
      
      this.apiKey = this.defaultClient.authentications["api-key"];
      this.apiKey.apiKey = process.env.SIB;
      this.next();
    },
    buildSmsInstance: function() {
      this.apiInstance = new this.SibApiV3Sdk.TransactionalSMSApi();
      this.sendTransacSms = new this.SibApiV3Sdk.SendTransacSms();
      this.next();
    },
    buildSmsParams: function() {
      var body = this._body;
      this.sendTransacSms.sender = body.from;
      this.sendTransacSms.recipient = body.to;
      this.sendTransacSms.content = body.message;
      this.next();
    },
    buildSibParams: function() {
      var body = this._body;
      this.sendSmtpEmail = {
          to: [{
              email: body.email,
              name: body.name
          }],
          templateId: body.template || 1,
          params: body.params
      };
      this.next();
    },
    buildEmailInstance: function() {
      this.apiInstance = new this.SibApiV3Sdk.TransactionalEmailsApi();
      this.sendSmtpEmail = new this.SibApiV3Sdk.SendSmtpEmail();
      this.next();
    },
    contactSave: function() {
      var createContact = new this.SibApiV3Sdk.CreateContact(),
          self = this;
      
      createContact = this._body;
      this.apiInstance.createContact(createContact).then(function(data) {
        self.next({
          body: self._body,
          response: data
        });
      }, function(error) {
        self.error(error);
      });
    },
    createContactInstance: function() {
      this.apiInstance = new this.SibApiV3Sdk.ContactsApi();
      this.next();
    },
    missingNumber: function() {
      this.next(!this._body.to);
    },
    missingSibRecipient: function() {
      this.next(!this._body.email);
    },
    sendSibEmail: function() {
      var self = this;
      this.apiInstance.sendTransacEmail(this.sendSmtpEmail).then(function(data) {
        self.next({
          message: "API called successfully. Returned data: ",
          data: data
        });
      }, function(error) {
        self.next({
          error: "<(-_-)>" + error
        });
      });
    },
    sendSms: function() {
      var self = this;
      this.apiInstance.sendTransacSms(this.sendTransacSms).then(function(data) {
        self.next(data);
      }, function(error) {
        self.error(error);
      });
    },
    toSibMethod: function() {
      this.next(this._arg1);
    }
  },
  instruct: {
    switch: "toSibMethod",
    createContact: [
      "BuildSibApi",
      "createContactInstance",
      "contactSave"
    ],
    email: [
      { if: "missingSibRecipient", true: "alertNeedRecipient" },
      "BuildSibApi",
      "buildEmailInstance",
      "buildSibParams",
      "sendSibEmail"  
    ],
    sms: [
      { if: "missingNumber", true: "alertNeedNumber"},
      "BuildSibApi",
      "buildSmsInstance",
      "buildSmsParams",
      "sendSms"
    ]
  }
});
global.smartsheet = new Chain({
  input: {
    ssKey: process.env.SSKEY
  },
  steps: {
    setupSmartSheet: function() {
      this.smartsheet = ssClient.createClient({
        accessToken: this.ssKey,
        logLevel: "info"
      });
      this.next();
    },
    renderSmartSheetData: function() {
      var self = this;
      this.smartsheet.sheets.listSheets({})
        .then(function (result) {
          var sheetId = result.data[0].id;
      
          // Load one sheet
          self.smartsheet.sheets.getSheet({id: sheetId})
            .then(function(sheetInfo) {
              self.next(sheetInfo);
            })
            .catch(function(error) {
              self.error(error);
            });
        })
        .catch(function(error) {
          self.error(error);
        });
    }
  },
  instruct: [
    "setupSmartSheet",
    "renderSmartSheetData"  
  ]
});
global.verify = new Chain({
  input: function() {
    return {
      token: this._arg1
    };
  },
  steps: {
    alertFailedToVerify: function() {
      this.error("<(-_-)> Failed to verify, you have.");
    },
    alertMissingToken: function() {
      this.error("<(-_-)> Missing verification token, you are.");
    },
    decodeSuccessful: function() {
      this.next(this.decoded.token == this.dUser.status);
    },
    decodeToken: function() {
      var self = this;
      jwt.verify(this.token, process.env.VERIFY, function (tokenErr, decoded) {
        if(tokenErr) return self.error(tokenErr);
        self.decoded = decoded;
  			self.next();
  		});
    },
    lookupDecodedUser: function() {
      var self = this;
      models.users.findById(this.decoded.userid, function(err, user){
        if(err) return self.error(err);
        self.dUser = user;
        self.next();
      });
    },
    noToken: function() {
      this.next(!this.token);
    },
    redirectToDomain: function() {
      this._callback(null, {
        statusCode: 301,
        headers: {
          Location: "https://"+this._domain,
        }
      });
    },
    verifyUser: function() {
      var self = this;
      models.users.findByIdAndUpdate(this.dUser.id, { status:"verified" }, { new: true }, function(err, data){
        if(err) return self.error(err);
        self.next("<(-_-)> Successfully verified, you are. Continue to https://"+self._domain);
      });
    }
  },
  instruct: {
    if: "noToken",
    true: "alertMissingToken",
    false: [
      "decodeToken",
      "lookupDecodedUser",
      {
        if: "decodeSuccessful",
        true: [
          "verifyUser",
          // "redirectToDomain"
          ],
        false: "alertFailedToVerify"
      }
    ]
  }
});
global.port = new Chain({
  input: function() {
    return {
      permits: [],
      sheets: [],
      user: {
        username: "public"
      }
    };
  },
  steps: {
    addDetails: function(last, next) {
      var index = Object.assign({}, this._memory.storage);
      delete index._callback;
      next(index);
    },
    fetchSite: function(res, next) {
      var self = this;
      models.sites.findOne({
        name: self._siteName
      }).then(function(siteObj){
        if(siteObj) {
          self.siteObj = siteObj;
          self.siteId = siteObj._id;
        }
        next(siteObj);
      });
    },
    fetchUser: function() {
      var self = this;
      this.userid = this._cookies.userid;
      models.users.findById(this.userid, function(err, user){
        if(err) return self.error(err);
        if(!user) return self.error("<(-_-)> Not existing in archives, user "+ self.userid +" is.");
        self.user = user;
        self.next();
      });
    },
    fetchUserPermitsForSite: function() {
      var self = this;
      permits.find({
        siteId: this.siteId
      }, function(err, foundPermits){
        if(err || !foundPermits) return self.error(err);
        
        var username = self.user.username,
            userPermits = foundPermits.find({ username: username }),
            publicPermits = foundPermits.find({ username: "public" });
        
        for(var i=0; i<publicPermits.length; i++) {
          var publicPermit = publicPermits[i],
              willNotOverwriteUserPermit = !userPermits.findOne({ sheetId: publicPermit.sheetId });
              
          if(willNotOverwriteUserPermit) userPermits.push(publicPermit);
        }
        
        self.permits = userPermits;
        
        self.next();
      });
    },
    getSiteName: function() {
      // this._siteName = this.customDomain;
      // this.next();
      
      var domainArray = this._domain.split(".");
      this._siteName = domainArray.length === 2 ? domainArray[0] : domainArray[1];
      this.next();
    },
    isVerbose: function(res, next) {
      next(this._query.verbose);
    },
    loggedOut: function() {
      var self = this;
      jwt.verify(this._cookies.token, this.user.password, function (tokenErr, decoded) {
  			self.next(!!tokenErr);
  		});
    },
    noSiteExists: function(siteObj, next) {
      next(!siteObj);
    },
    noSiteSpecified: function() {
      this.next(!this._siteName);
    },
    renderLoggedOut: function() {
      this.next({
        body: render("login-portal", this),
        type: "html"
      });
    },
    renderNoSiteExists: function(res, next) {
      next({
        body: "<h1><(-_-)> Not Existing In Archives Site, " + this._siteName + " Is.</h1>", 
        type: "text/html"
      });
    },
    renderNoPermitsExistForSite: function() {
      this.next({
        body: render("login-portal", this),
        type: "text/html"
      });
    },
    renderWelocomeToUiSheet: function() {
      this.next({
        body: render("login-portal", this),
        type: "html"
      });
    },
    runChain: function(res, next) {
      var self = this,
          chainName = this._chain,
          chain = global[chainName];
      if(!chain) return this.error("<(-_-)> Not existing in archives, chain " + chainName + " is.");
      chain.import(this._memory.storage).start().then(function(memory){
        memory._endChain = false;
        self._memory.import(memory);
        self.next(memory.last);
      }).catch(function(err){
        self.error(err);
      });
    },
    urlHasAChain: function(res, next) {
      next(!!this._chain);
    },
    userHasCookies: function() {
      this.next(!!this._cookies.userid);
    },
    userHasNoPermitsForSiteAndNotUisheet: function() {
      this.next(this.permits.length == 0 && this.siteObj.name !== "uisheet");
    },
    userIsPublic: function() {
      this.next(this.user.username == "public");
    },
    usingCustomDomain: function() {
      // var genericSiteNames = ["uisheet", "uisheet", "amazonaws"],
      //     domainArray = this._domain.split(".");
      // this.customDomain = domainArray.length === 2 ? domainArray[0] : domainArray[1];
      // this.next(genericSiteNames.excludes(this.customDomain));
      
      var genericSiteNames = ["uisheet.com", "amazonaws.com"],
          usingCustomDomain = true;
      for(var i=0; i<genericSiteNames.length; i++) {
        var genericSiteName = genericSiteNames[i];
        if(usingCustomDomain && this._domain.includes(genericSiteName)) usingCustomDomain = false;
      }
      this.next(usingCustomDomain);
    }
  },
  instruct: [
    "connectToDb",
    { if: "usingCustomDomain", true: "getSiteName" }, // remove this when not using custom domain yet
    {
      if: "userHasCookies",
      true: [
        "fetchUser",
        { if: "loggedOut", true: ["renderLoggedOut", "serve"] }
      ]
    },
    {
      if: "noSiteSpecified",
      true: [
        {
          if: "userIsPublic",
          true: "renderWelocomeToUiSheet",
          false: "renderUserLibrary"
        },
        "serve"
      ]
    },
    "fetchSite",
    { if: "noSiteExists", true: [ "renderNoSiteExists", "serve" ] },
    "fetchUserPermitsForSite",
    {
      if: "userHasNoPermitsForSiteAndNotUisheet",
      true: [
        {
          if: "urlHasAChain",
          true: "runChain",
          false: "renderNoPermitsExistForSite"
        },
        "serve"
      ]
    },
    "_fetchSheetForEachPermit",
    {
      if: "urlHasAChain",
      true: "runChain",
      false: "renderUserLandingPage"
    },
    { if: "isVerbose", true: "addDetails" },
    "serve"  
  ]
});

var handleError = function(callback, error) {
  callback(null, {
    statusCode: 400,
    body: error.stack || error
  });
};
var importParamaters = function(event, context, callback) {
  context.callbackWaitsForEmptyEventLoop = false;
  
  var params = event.pathParameters || {},
      siteName = params.site || "uisheet",
      hostPath = event.headers.Host.includes("amazonaws.com")
                 ? "/dev"+hostPath
                 : "/"+siteName;
  
  return {
    _arg1: params.arg1,
    _arg2: params.arg2,
    _body: JSON.parse(event.body || "{}"),
    _callback: callback,
    _chain: params.chain,
    _context: context,
    _cookie: event.headers.Cookie || "not having cookie, you are.",
    _cookies: cookie.parse(event.headers.Cookie || "{}") || "not having cookie, you are.",
    _domain: event.requestContext.domainName,
    _event: event,
    _eventMethod: event.httpMethod.toLowerCase(),
    _headers: event.headers || {},
    _host: "https://"+event.headers.Host+hostPath,
    _query: event.queryStringParameters || {},
    _siteName: params.site
  };
};

module.exports.bulk = function(event, context, callback) {
  var input = importParamaters(event, context, callback);
  
  new Chain({
    steps: {
      postBulkItems: function() {
        var self = this,
            options = { ordered: false };
        this.model.insertMany(this._body, options, function(err, doc) {
          if(err) {
            self.next({message: err});
            return;
          }
          self.next("Success");
        });
      }
    },
    instruct: [
      "connectToDb",
      { if: "usingCustomDomain", true: "getSiteName" },
      { if: "userHasCookies", true: "fetchUser" },
      "fetchSite",
      "fetchUserPermitsForSite",
      "_fetchSheetForEachPermit",    
      "model",
      "postBulkItems",
      "serve"
    ]
  }).start(input).catch(function(error){
    handleError(callback, error);
  });
};

module.exports.port = function(event, context, callback) {
  var input = importParamaters(event, context, callback);
  
  global.port.start(input).catch(function(error){
    handleError(callback, error);
  });
};
} catch (e) {
  module.exports.port = function(event, context, callback) {
    handleError(callback, e);   
  };
}

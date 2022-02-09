"use strict";

try {
const AWS = require("aws-sdk");
const s3 = new AWS.S3();
const mime = require("mime");
const Utils = require("./scripts/utils");
const Chain = require("./scripts/chain");
const permits = require("./models/permits");
const accounts = require("./models/accounts");
var models = {
  sheets: require("./models/sheets"),
  sites: require("./models/sites"), 
  users: require("./models/users"),
  permits: permits
};
const lambda = new AWS.Lambda({ region: "us-west-1" });
const mongoose = require("mongoose");
const cookie = require("cookie");
let isConnected;
const emptySheet = require("./utils/emptySheet");
const emptyPermit = require("./utils/emptyPermit");
const fs = require("fs");
let favicon;
const nodeFetch = require("node-fetch").default;
const { Configuration, PlaidApi, PlaidEnvironments } = require("plaid");
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
const EasyPost = require("@easypost/api");

global.accounts = new Chain({
  input: function() {
    return {
      accountMethod: this._arg1,
      institutionIdId: this._arg2
    };
  },
  steps: {
    lookupPlaidAccount: function() {
      var body = this._body;
          
      accounts.findOne(body, (error, pAccount) => {
        if(error) return this.error(error);
        this.next(pAccount);
      });
    },
    toAccountMethod: function() {
      this.next(this.accountMethod);
    }
  },
  instruct: {
    switch: "toAccountMethod",
    lookup: "lookupPlaidAccount"
  }
});
global._brainQueryCustomer = new Chain({
  input: function() {
    return {
      brainMethod: this._arg1,
      brainPublic: process.env.BTPUBLIC,
      brainPrivate: process.env.BTPRIVATE,
      endpoint: "https://payments.sandbox.braintree-api.com/graphql",
    };
  },
  steps: {
    announceNoBrainCustomer: function() {
      this.next({
        success: false,
        customer: "<(-_-)> Not having a braintree account, this user is."
      });
    },
    buildQueryCustomerSearch: function() {
      var brainId = this.user.brainId;
      this.query = {
        query: `
        query Search($input: CustomerSearchInput!) {
          search {
            customers(input: $input) {
        			edges {
                node {
                  id
                  email
                  firstName
                  lastName
                  company
                  phoneNumber
                }
              }
            }
          }
        }
        `,
        variables: {
          input: {
            id: {
              is: brainId
            }
          }
        }
      };
      this.next();
    },
    defineBrainCustomer: function(last) {
      var data = last.data || {};
      var search = data.search || {};
      var customers = search.customers || {};
      var edges = customers.edges || [];
      this.brainCustomer = edges[0];
      this.next(this.brainCustomer);
    },
    userHasBrainId: function() {
      this.next(!!this.user && !!this.user.brainId);
    }
  },
  instruct: {
    if: "userHasBrainId", 
    true: [
      "buildBrainAuth",
      "buildBrainHeaders",
      "buildQueryCustomerSearch",
      "fetchGraphql",
      "defineBrainCustomer"
    ],
    false: "announceNoBrainCustomer"
  }
});
global.brain = new Chain({
  input: function() {
    return {
      brainMethod: this._arg1,
      brainPublic: process.env.BTPUBLIC,
      brainPrivate: process.env.BTPRIVATE,
      endpoint: "https://payments.braintree-api.com/graphql",
    };
  },
  steps: {
    alertHasBrainCustomer: function() {
      this.next(`<(-_-)> Already with brain, ${this.user.username} is.`);
    },
    buildBrainAuth: function() {
      var keys = this.brainPublic+":"+this.brainPrivate;
      this.brainAuth = "Basic " + Buffer.from(keys).toString("base64");
      
      this.next();
    },
    buildBrainHeaders: function() {
      this.brainHeaders = {
        "Content-Type": "application/json",
        "Authorization": this.brainAuth,
        "Braintree-Version": "2019-01-01"
      };
      this.next();
    },
    buildQueryAuthorizePaymentMethod: function() {
      var b = this._body,
          customerId = this.user.brainId;
          
      this.query = {
        query: `
          mutation AuthorizeBrain($input: AuthorizePaymentMethodInput!) {
            authorizePaymentMethod(input: $input) {
              transaction {
                id
                status
              }
            }
          }
        `,
        variables: {
          input: {
            paymentMethodId: b.nonce,
            transaction: {
              amount: b.amount,
              customerId: customerId,
              riskData: { deviceData: b.deviceData },
              vaultPaymentMethodAfterTransacting: {
                when: "ON_SUCCESSFUL_TRANSACTION"
              }
            }
          }
        }
      };
      this.next(); 
    },
    buildQueryCaptureTransaction: function() {
      this.query = {
        query: `
        mutation CaptureIt($input: CaptureTransactionInput!) {
          captureTransaction(input: $input) {
            transaction {
              id
              status
            }
          }
        }
        `,
        variables: {
          input: {
            transactionId: this._body.authCode
          }
        }
      };
      this.next(); 
    },
    buildQueryChargePaymentMethod: function() {
      var b = this._body,
          customerId = this.user.brainId;
          
      this.query = {
        query: `
          mutation ChargeBrain($input: ChargePaymentMethodInput!) {
            chargePaymentMethod(input: $input) {
              transaction {
                id
                status
              }
            }
          }
        `,
        variables: {
          input: {
            paymentMethodId: b.nonce,
            transaction: {
              amount: b.amount,
              customerId: customerId,
              riskData: { deviceData: b.deviceData },
              vaultPaymentMethodAfterTransacting: {
                when: "ON_SUCCESSFUL_TRANSACTION"
              }
            }
          }
        }
      };
      this.next();
    },
    buildQueryCreateCustomer: function() {
      var u = this.user;
      this.query = {
        query: 
        `mutation CreateCustomerInput($input: CreateCustomerInput!) {
          createCustomer(input: $input) {
            customer {
              id
            }
          }
        }
        `,
        variables: {
            input: {
          		customer: {
          		  email: u.email
          		}
            }
        }
      };
      this.next();
    },
    buildQueryGetClientToken: function() {
      this.query = {
        query: `
        mutation GetClientToken($input: CreateClientTokenInput) {
          createClientToken(input: $input) {
            clientToken
          }
        }
        `,
        variables: {
          input: { 
            clientToken: this._body
          }
        }
      };
      this.next();
    },
    buildQueryCancel: function() {
      this.query = {
        query: `
          mutation Reverse($input: ReverseTransactionInput!) {
            reverseTransaction(input: $input) {
      				reversal {
                __typename
              }
            }
          }
        `,
        variables: {
          "input": {
        		"transactionId": this._body.authCode
          }
        }
      };
      this.next();      
    },
    buildQueryReverseRefund: function() {
      this.query = {
        query: `
        mutation ReverseRefund($input: ReverseRefundInput!) {
          reverseRefund(input: $input) {
    				refund {
              id
            }
          }
        }
        `,
        variables: {
          "input": {
            "refundId": this._body.refundId
          }
        }
      };
      this.next();    
    },
    buildQueryRefund: function() {
      this.query = {
        query: `
          mutation Refund($input: RefundTransactionInput!) {
            refundTransaction(input: $input) {
            	refund {
                amount {
                  value
                }
                status
              }
            }
          }
        `,
        variables: {
          "input": {
        		"transactionId": this._body.authCode,
            "refund": {
              "amount": this._body.amount
            }
          }
        }
      };
      this.next();      
    },
    buildQueryTransaction: function() {
      this.query = {
        query: `
          query Search($input: TransactionSearchInput!) {
            search {
              transactions(input: $input) {
                edges {
                  node {
                    id
                    orderId
                    status
                    refunds {
                      id
                      status
                      amount {
                        value
                      }
                    }
                    customer {
                      id
                    }
                    amount {
                      value
                    }
                  }
                }
              }
            }
          }
        `,
        variables: {
          "input": {
        		"id": {
              "is": this._body.authCode
            }
          }
        }
      };
      this.next();
    },
    buildQueryUpdateAmount: function() {
      this.query = {
        query: `
        mutation updateTotal($input: UpdateTransactionAmountInput!) {
        	updateTransactionAmount(input:$input) {
            transaction{
              id
              amount {
                value
              }
            }
          }
        }
        `,
        variables: {
          input: {
						"amount": this._body.amount,
          	"transactionId": this._body.authCode
          }
        }
      };
      this.next(); 
    },
    fetchGraphql: function() {
      var body = {
        method: "POST",
        headers: this.brainHeaders,
        body: JSON.stringify(this.query)
      };
      
      var self = this;
      nodeFetch(this.endpoint, body).then(res=>res.json()).then(function(data) {
        self.next(data);
      });    
    },
    hasCustomer: function() {
      this.next(!!this.brainCustomer);
    },
    locateBrainId: function(last) {
      var customerData = last.data || {};
      var created = customerData.createCustomer || {};
      var customer = created.customer;
                     
      this.brainId = customer.id,
      
      this.next();
    },
    saveBrainIdToUser: function() {
      var self = this,
          brainIdBody = {
            brainId: this.brainId
          };
          
      this.user.brainId = this.brainId;
          
      models.users.findByIdAndUpdate(this.userid, brainIdBody, { new: true }, function(err, data){
        if(err) return self.error(err);
        self.next(data);
      });
    },
    sendClientToken: function(last) {
      var data = last.data || {};
      var created = data.createClientToken || {};
      var clientToken = created.clientToken || null;
      this.next(clientToken);
    },
    sendTransaction: function(last) {
      var data = last.data || {};
      var search = data.search || {};
      var transactions = search.transactions || {};
      var edges = transactions.edges || [];
      var transaction = edges[0] || {};
      var response = transaction.node || {
        data: data,
        message: "<(-_-)> Not found, "+this._body.authCode+" transaction is..."
      };
      this.next(response);
    },
    toBrainMethod: function() {
      this.next(this.brainMethod || "getClientToken");
    }
  },
  instruct: [
    "buildBrainAuth",
    "buildBrainHeaders",
    {
      switch: "toBrainMethod",
      authorize: {
        if: "userHasBrainId",
        false: "announceNoBrainCustomer",
        true: [ "buildQueryAuthorizePaymentMethod", "fetchGraphql" ]
      },
      cancel: [ "buildQueryCancel", "fetchGraphql" ],
      capture: {
        if: "userHasBrainId",
        false: "announceNoBrainCustomer",
        true: [ "buildQueryCaptureTransaction", "fetchGraphql" ] 
      },
      charge: {
        if: "userHasBrainId",
        false: "announceNoBrainCustomer",
        true: [ "buildQueryChargePaymentMethod", "fetchGraphql" ]
      },
      createNewCustomer: [
        "_brainQueryCustomer",
        {
          if: "hasCustomer",
          true: "alertHasBrainCustomer",
          false: [
            "buildQueryCreateCustomer",
            "fetchGraphql",
            "locateBrainId",
            "saveBrainIdToUser"
          ]
        }
      ],
      refund: [ "buildQueryRefund", "fetchGraphql" ],
      reverseRefund:  [ "buildQueryReverseRefund", "fetchGraphql" ],
      transaction: [
        "buildQueryTransaction",
        "fetchGraphql",
        "sendTransaction"
      ],
      queryCustomer: "_brainQueryCustomer",
      token: [ "buildQueryGetClientToken", "fetchGraphql", "sendClientToken" ],
      update: [ "buildQueryUpdateAmount", "fetchGraphql" ]
    }
  ]
});
global._buildModel = new Chain({
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
    "_checkPermit",
    {
      if: "sheetNameIsNative",
      true: "relayNativeModel",
      false: [
        "_grabSheet",
        "defineCollectionName",
        "_buildSchema",
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
global._buildSchema = new Chain({
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
    "_checkPermit",
    "_grabSheet",
    "forEachItemInSchema", ["convertToFuncion"],
    function() {
      this.next(this.stringSchema);
    }
  ]
});
global._checkEmailVerified = new Chain({
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
      if(this._cookies.status == "verified" || this.user.username=="public") return this.next(false);
      
      if(!this.user) return this.error("<(-_-)> Missing user, you are.");
      
      var dateFromObjectId = function (objectId) {
          	return new Date(parseInt(objectId.substring(0, 8), 16) * 1000);
          },
          createdOn = dateFromObjectId(this._cookies.userid),
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
global._checkPermit = new Chain({
  input: function() {
    return {
      sheetName: this._arg1 || "sheets",
      id: this._arg2,
      validDefaults: ["users", "sites"]
    };
  },
  steps: {
    alreadyHasPermit: function() {
      this.next(!!this.permit);
    },
    alertPermitExcludesMethod: function() {
      this.error("<(-_-)> Method is prohibited, your permit declares.");
    },
    alertNoPermitExists: function() {
      this.error("<(-_-)> Not found in archives, your permit is.");
    },
    fetchPublicPermit: function() {
      var self = this,
          filters = {
            siteId: this.siteId,
            username: "public",
            sheetId: ((this.sheet || {})._id || "").toString() || this.id,
          };
      permits.findOne(filters, function(error, permit) {
        if(error) return self.error(error);
        self.permit = permit;
        self.next();
      });      
    },
    fetchPermitForPermit: function() {
      var self = this,
          filters = { 
            sheetId: this._query.sheetId,
            username: this.user.username
          };
      
      if(this.permits && this.permits.length) {
        this.permit = this.permits.findOne(filters);
        this.next();
        return;
      }

      permits.findOne(filters, function (err, permit) {
        self.permit = permit;
        self.next();
      });
    },
    grabPermit: function() {
      var filters = { 
            siteId: this.siteId,
            sheetId: this.sheet._id.toString(),
            username: this.user.username
          };
      
      if(this.permits && this.permits.length) {
        this.permit = this.permits.findOne(filters);
        this.next();
        return;
      }
      
      var self = this;
      permits.findOne(filters, function (err, permit) {
        if(err) return self.error(err);
        self.permit = permit;
        self.next();
      });
    },
    noPermitExists: function() {
      this.next(!this.permit);
    },
    permitExcludesMethodForProp: function() {
      var prop = this.sheetName == "permits" ? "permit" : "db",
          userPermissions = this.permit[prop].methods,
          action = this.id == "updateMany"
                  ? "updateMany"
                  : this._eventMethod == "post" && Array.isArray(this._body)
                  ? "bulkImport"
                  : this._eventMethod;
          
      this.next(userPermissions.excludes(action));
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
    sheetNeedsADefaultPermit: function() {
      this.next(this.validDefaults.indexOf(this.sheetName) > -1);
    },
    sheetNameIsPermits: function() {
      this.next(this.sheetName=="permits");
    },
    sheetIsNormal: function() {
      var notADefault = this.validDefaults.indexOf(this.sheetName) < 0,
          nameIsntPermits = this.sheetName !== "permits";
          
      this.next(notADefault && nameIsntPermits);
    },
    userIsNotPublic: function() {
      this.next(this.user.username !== "public");
    }
  },
  instruct: {
    if: "sheetNeedsADefaultPermit", 
    true: "sendDefaultPermit",
    false: [
      { if: "sheetNameIsPermits", true: "fetchPermitForPermit" },
      { if: "sheetIsNormal", true: [ "_grabSheet", "grabPermit" ] },
      {
        if: "noPermitExists", 
        true: [
          { if: "userIsNotPublic", true: "fetchPublicPermit" },
          { if: "noPermitExists", true: "alertNoPermitExists" }
        ]
      },
      { if: "permitExcludesMethodForProp", true: "alertPermitExcludesMethod" },
      // { 
      //   if: "usernameIsPublicAndUrlHasId",
      //   true: { if: "permitAllowsId", false: "alertPermitExcludesMethod" }
      // } 
    ]
  }
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
        self.next("Init Connect");
      });
    },
    promiseResolve: function() {
      Promise.resolve();
      this.next("Connected");
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
      sheetName: this._arg1,
      stamp: Date.now()
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
    addSheetIdToBody: function() {
      var sheet = this.sheet || {},
          sheetId = this._query.sheetId || this.sheet._id;
      this._body.sheetId = sheetId;
      this.next();
    },
    addToOptions: function() {
      this.options[this.key] = this.nativeOptions[this.key](this.value);
      this.next();
    },
    addUserIdToQuery: function() {
      this._query.userIds = "/"+this.userid+"/";
      this.next();
    },
    addUsernameToFilter: function() {
      this.filter.username = this.user.username;
      this.next();
    },
    addToFilter: function() {
      this.filter[this.key] = this.value;
      this.next();
    },
    alertNeedPermissionFromAuthor: function() {
      this.error("<(-_-)> Permission from author, you must have.");
    },
    bulkImport: function() {
      var self = this;
      
      lambda.invoke({
        FunctionName: "uisheet-dev-bulk",
        Payload: JSON.stringify(self._event),
        InvocationType: "Event"
      }, function(error, lambdaResponse) {
        if(error) return self.error(error);
        self.next({
          yoda: {
            event: self._event,
            message: "<(-_-)> Imported " + self._body.length + " items to " + self.sheetName + ", you have."
          },
          lambdaResponse: lambdaResponse
        });
      });

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
          newSheet: self._postedItem
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
    deletePermit: function() {
      var self = this;
      models.permits.findByIdAndRemove(this.item._id, function(err, data){
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
    forEachAddRules: function() {
      if(!this.permit.db.rules) return this.next([]);
      
      var event = this._eventMethod;
      this.next(this.permit.db.rules[event].add); 
    },
    addRule: function() {
      var keys = Object.keys(this.item),
          prop = keys[0],
          value = this.item[prop];
      
      value = value.includes("'")
              ? value.replaceAll("'","")
              : this[value];
              
              
      if(this._eventMethod == "get") {
        this.filter[prop] = value;
      } else if(this.id == "updateMany") {
        this._body.update[prop] = value;
      } else if(Array.isArray(this._body)) {
        this._body.forEach(function(bItem) {
          bItem[prop] = value;
        }); 
      } else {
        this._body[prop] = value;
      }
      
      this.next();
    },
    forEachRemoveRules: function() {
      if(!this.permit.db.rules) return this.next([]);
      
      var event = this._eventMethod;
      this.next(this.permit.db.rules[event].remove); 
    },
    removeRule: function() {
      if(this._eventMethod == "get") {
        var select = this.options.select || "",
            isNegating = this.item.includes("-");
            
        if(isNegating) {
          var negator = this.item.replace("-", "");
          if(select.includes(negator)) {
            select = select.replaceAll(" "+negator, "");
            select = select.replaceAll(negator, "");
          } else if(select.includes("-") || select == "") {
            select += (" "+this.item);
          }
        } else {
          select += (" "+this.item);
        }
        this.options.select = select;
      } else if(this.id == "updateMany") {
        delete this._body.update[this.item];
      } else if(Array.isArray(this._body)) {
        var remover = this.item;
        this._body.forEach(function(bItem) {
          delete bItem[remover];
        }); 
      } else {
        delete this._body[this.item];
      }
      
      this.next();
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
    forEachPermitForSheet: function() {
      var self = this,
          filter = { sheetId: this.id },
          options = { select: "_id" };
      permits.find(filter, null, options, function(err, permits){
        if(err) return self.error(err);
        self.next(permits);
      });
    },
    forEachQueryKey: function() {
      this.next(this._query);
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
    findById: function(res, next) {
      var self = this;
      this.model.findById(this.id, null, this.options, function(err, item) {
        if(err) return self.error(err);
        self.itemFound = item;
        next(item);
      });
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
      var caveats = ["sites", "users", "sheets", "permits"];
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
    permitAlreadyExists: function() {
      var self = this; // to do
      permits.findOne({
        username: this._body.username,
        siteId: this.siteId,
        sheetId: this.sheet._id
      }).then(function(permit){
        self.next(!!permit);
      });
    },
    permitHasRules: function() {
      var rules = this.permit.db.rules,
          ruleCount = rules.get.add.length;
    },
    postItem: function() {
      var self = this;
      this.model.create(this._body, function(err, data){
        if(err) return self.error(err);
        self._postedItem = data;
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
    removeBrainId: function() {
      delete this._body.brainId;
      this.next();
    },
    removePassword: function() {
      delete this._body.password;
      this.next();
    },
    removeSheetNameFromFilter: function() {
      delete this.filter._sheetName;
      this.next();
    },
    saveToGlobalPlaid: function() {
      var savedAccount = this._postedItem,
          account = {
            institutionId: savedAccount.institutionId,
            userId: savedAccount.userId,
            siteId: this.siteId,
            sheetId: this.sheet._id
          };
          
      accounts.create(account, (err, data) => {
        if(err) return this.error(err);
        this.next({
          saved: savedAccount,
          simple: data
        });
      });
    },
    setNewPassword: function() {
      var self = this;
      this.user.hashPassword(this._body.newPassword, function(hashed){
        self.user.password = hashed;
        self._body = self.user;
        self.next();
      });
    },
    siteIsUisheet: function() {
      this.next(this._body.name=="uisheet");
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
    updateAllSiteStamps: function() {
      var update = { cacheStamp: Date.now() },
          self = this;
      models.sites.update({}, {"$set":update}, {"multi": true}, function(err, data) {
        if(err) return self.error(err);
        self.next();
      });
    },
    updateSiteCacheStamp: function() {
      this._body.cacheStamp = Date.now();
      this.next();
    },
    updateAndSaveSiteCacheStamp: function() {
      var body = { cacheStamp: Date.now() },
          self = this;
      models.sites.findByIdAndUpdate(this.siteId, body, { new: true }, function(err, data){
        if(err) return self.error(err);
        self.next();
      });
    },
    userIdDoesntMatch: function() {
      var item = this.itemFound,
          itemUserId = item.userId || item._id;
          
      this.next(this.userid != itemUserId);
    },
    userIdDoesntHaveAccess: function() {
      var item = this.itemFound || {},
          itemUserIds = item.userIds;
          
      this.next(itemUserIds.excludes(this.userid));
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
    },
  },
  instruct: [
    "_checkEmailVerified",
    "_checkPermit",
    "_buildModel",
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
        "forEachAddRules", [ "addRule" ],
        "forEachRemoveRules", [ "removeRule" ],
        { if: "isDbCount", true: ["getCount", "serve"] },
        { 
          if: "hasId", 
          true: [
          "findById", 
          {
            switch: "toCaveats",
            users: {
              if: "userIdDoesntMatch",
              true: "alertNeedPermissionFromAuthor"              
            }
          },
          "serve"
          ]
        },
        {
          switch: "toCaveats",
          sites: ["_fetchAllUserSites", "serve"],
          sheets: "addSiteIdToFilter",
          permits: ["addSiteIdToFilter", "removeSheetNameFromFilter"],
          users: "addUsernameToFilter"
        },
        {
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
      ],
      put: [
        "forEachAddRules", [ "addRule" ],
        "forEachRemoveRules", [ "removeRule" ],
        {
          if: "hasSpecialCaveates",
          true: {
            switch: "toCaveats",
            permits: ["updateAndSaveSiteCacheStamp", "updateItem"],
            sites: [
              "lookupSiteAuthor",
              {
                if: "userIsAuthorOfSite",
                true: [
                  {
                    if: "siteIsUisheet",
                    true: "updateAllSiteStamps",
                    false: "updateSiteCacheStamp"
                  },
                  "updateItem"
                ],
                false: "alertNeedPermissionFromAuthor"
              }
            ],
            sheets: ["updateAndSaveSiteCacheStamp", "updateItem"],
            users: [
              "fetchUserFromCookie",
              {
                if: "userDoesntExist",
                true: "alertUserDoesntExist",
                false: {
                  if: "passwordAuthenticates",
                  true: { 
                    if: "hasNewPassword",
                    true: ["setNewPassword", "removeBrainId", "updateItem", "createCookies", "sendCredentials"],
                    false: ["removePassword", "removeBrainId", "updateItem"]
                  },
                  false: "alertPasswordsDontMatch"
                }
              }
            ]
          },
          false: { if: "isUpdateMany", true: "updateMany", false: "updateItem" }
        }
      ],
      post: [
        "forEachAddRules", [ "addRule" ],
        "forEachRemoveRules", [ "removeRule" ],
        { 
          switch: "toCaveats",
          permits: ["updateAndSaveSiteCacheStamp", "addSiteIdToBody", "addSheetIdToBody"],
          sites: "addAuthorToBody",
          sheets: ["updateAndSaveSiteCacheStamp", "addAuthorToBody", "addSiteIdToBody" ]
        },
        {
          if: "moreThanOneItem",
          true: "bulkImport",
          false: [
            "postItem",
            {
              switch: "toCaveats",
              accounts: "saveToGlobalPlaid",
              sites: [ "createSheetForNewSite", "createPermitForNewSite" ],
              sheets: [ "createPermitForSheet" ]
            }
          ]
        }
      ],
      delete: [
        {
          switch: "toCaveats",
          permits: ["updateAndSaveSiteCacheStamp", "deleteItem", "serve"],
          sheets: [
            "updateAndSaveSiteCacheStamp",
            "forEachPermitForSheet", loop(["deletePermit"]),
            "deleteItem",
            "serve"
          ],
          sites: [
            "lookupSiteAuthor",
            {
              if: "userIsAuthorOfSite",
              true: [
                "deleteItem",
                "forEachSheetInSite", loop(["deleteSheet"]),
                "forEachPermitInSite", loop(["deletePermit"]),
                "serve"
              ],
              false: ["alertNeedPermissionFromAuthor", "serve"]
            } 
          ],
          users: [
            "fetchUserFromCookie",
            {
              if: "userDoesntExist",
              true: "alertUserDoesntExist",
              false: {
                if: "passwordAuthenticates",
                true: ["deleteItem", "serve"],
                false: "alertPasswordsDontMatch"
              }
            }
          ]
        },
        {
          if: "droppingDb",
          true: "dropDb",
          false: "deleteItem"
        }
      ]
    }
  ]
}); 
global.ebay = new Chain({
  steps: {
    generateUserAuthToken: function() {
      const scopes = [
        "https://api.ebay.com/oauth/api_scope",
        "https://api.ebay.com/oauth/api_scope/sell.marketing.readonly",
        "https://api.ebay.com/oauth/api_scope/sell.marketing",
        "https://api.ebay.com/oauth/api_scope/sell.inventory.readonly",
        "https://api.ebay.com/oauth/api_scope/sell.inventory",
        "https://api.ebay.com/oauth/api_scope/sell.account.readonly",
        "https://api.ebay.com/oauth/api_scope/sell.account",
        "https://api.ebay.com/oauth/api_scope/sell.fulfillment.readonly",
        "https://api.ebay.com/oauth/api_scope/sell.fulfillment"
      ];
      const authUrl = this.ebayAuthToken.generateUserAuthorizationUrl("PRODUCTION", scopes);
      this.next({ authUrl });
    },
    getEbayToken: function() {
      this.ebayAuthToken.getApplicationToken("PRODUCTION").then(r => {
        this.next({
          message: "hi",
          responser: r
        });
      });
    },
    initEbayGateway: function() {
      var EbayAuthToken = require("ebay-oauth-nodejs-client"),
          pass = process.env;
      
      this.ebayAuthToken = new EbayAuthToken({
          clientId: pass.EBAYCLIENTID,
          clientSecret: pass.EBAYCLIENTSECRET,
          redirectUri: "isaac_robles-isaacrob-uishee-rffndtck"
      });
      
      this.next();
    },
    notifyToEbay: function() {
      var query = this._query,
          challengeCode = query.challenge_code,
          verificationToken = "oakandzazuliveinacabinandacageatnight",
          crypto = require("crypto"),
          endpoint = "https://www.uisheet.com/uisheet/ebay/notify",
          code = challengeCode + verificationToken + endpoint,
          hash = crypto.createHash("sha256").update(code).digest("hex");
          
      this.next({
        challengeResponse:hash
      });
    },
    toEbayMethod: function() {
      this.next(this._arg1);
    },
    testEbay: function() {
      
      var query = this._query,
          baseUrl = "https://api.ebay.com/",
          endpoint = query.endpoint || "buy/browse/v1/item_summary/search",
          url = baseUrl + endpoint + "?category_ids=108765&q=Beatles&filter=price:[200..500]&filter=priceCurrency:USD&limit=10";
          
      var token = query.token;
          
      var body = {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        }
      };
      
      nodeFetch(url, body).then(res=>res.json()).then( data => {
        this.next(data);
      });
    },
    testEbayAuth1: function() {
      var q = this._query,
          code = q.code,
          url = "https://api.ebay.com/identity/v1/oauth2/token",
          pass = process.env,
          keys = pass.EBAYCLIENTID+":"+pass.EBAYCLIENTSECRET,
          auth = "Basic " + Buffer.from(keys).toString("base64"),
          body = {
            method: "POST",
            headers: {
              "Content-Type": "application/x-www-form-urlencoded",
              "Authorization": auth,
            },
            body: {
              "grant_type": "authorization_code",
              "code": code,
              "redirect_uri": "isaac_robles-isaacrob-uishee-rffndtck"
            }
          };
          
      this.next(body);
          
      // nodeFetch(url, body).then(res=>res.json()).then( data => {
      //   this.next(data);
      // });
    },
  },
  instruct: {
    switch: "toEbayMethod",
    auth: [
      "initEbayGateway",
      // "getEbayToken",
      "generateUserAuthToken"
    ],
    notify: "notifyToEbay"
  }
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
      this.options.body = typeof this.fetchBody == "string" 
                          ? this.fetchBody 
                          : JSON.stringify(this.fetchBody);
      this.next();
    },
    addHeaders: function() {
      this.options.headers = this._body.headers;
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
    hasHeaders: function() {
      this.next(Object.keys(this._body).includes("headers"));
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
    { if: "hasHeaders", true: "addHeaders" },
    "fetchUrl"  
  ]
});
global._fetchAllUserSites = new Chain({
  input: {
    userSites: []
  },
  steps: {
    fetchAllPermitsForUser: function() {
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
    extractUniqueSiteIds: function() {
      var uniqueSiteIds = [];
      for(var i=0; i<this.userPermits.length; i++) {
        var permit = this.userPermits[i];
        if(uniqueSiteIds.indexOf(permit.siteId) == -1) {
          uniqueSiteIds.push(permit.siteId);
        }
      }
      this.uniqueSiteIds = uniqueSiteIds;
      this.next();
    },
    fetchSitesForUserPermits: function() {
      var self = this;
      
      if(this.filter) this.filter._id = { $in: this.uniqueSiteIds };
      
      models.sites.find(this.filter, null, this.options || {}, function(err, resSites){
        if(err) return self.error(err);
        self.next(resSites);
      });
    }
  },
  instruct: [
    "fetchAllPermitsForUser",
    "extractUniqueSiteIds",
    "fetchSitesForUserPermits"
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
          _ids = [];
          
      this.permits.forEach(function(permit) {
        var id = permit.sheetId;
        if(_ids.excludes(id)) _ids.push(id);
      });
      
      models.sheets.find({
        _id: { $in: _ids },
        siteId: this.siteId
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
    // "grabUserPermitsForSite",
    "fetchSheetsForUserPermits",
    // loop([ "define=>permit",
    //   {
    //     if: "userHasAccessToSheet",
    //     true: [
    //       "fetchCorrespondingSheet",
    //       "appendToSheets"
    //     ]
    //   }
    // ]),
    "sortSheets"
  ]
});
global._grabSheet = new Chain({
  input: function() {
    return {
      sheetName: this._arg1 || this._query
    };
  },
  steps: {
    alreadyHasSheet: function() {
      this.next(!!this.sheet);
    },
    alertNoSheetFound: function() {
      this.error("Not existing in archives, sheet " + this.sheetName + " is. Or enter you will, when permit you have.");
    },
    buildFilter: function() {
      this.sheetFilter = {
        name: this.sheetName,
        siteId: this.siteId
      };
      this.next();
    },
    fetchSheet: function() {
      var self = this;
      models.sheets.findOne(this.sheetFilter, "-ui", function(err, resSheet){
        if(err) return self.error(err);
        self.sheet = resSheet;
        self.next();
      });
    },
    hasSheets: function() {
      this.next(!!this.sheets && !!this.sheets.length);
    },
    lookupAndDefineSheet: function() {
      this.sheet = this.sheets.findOne(this.sheetFilter);
      this.next(this.sheet);
    },
    noSheetFound: function() {
      this.next(this.sheet === null);  
    }
  },
  instruct: {
    if: "alreadyHasSheet",
    false: [
      "buildFilter",
      {
        if: "hasSheets",
        true: "lookupAndDefineSheet",
        false: "fetchSheet"
      },
      { if: "noSheetFound", true: "alertNoSheetFound" }  
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
global._fetchMasterSite = new Chain({
  input: {
    masterSite: false,
  },
  steps: {
    fetchMasterSite: function() {
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
  instruct: { if: "masterSiteNotLoaded", true: "fetchMasterSite" }
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
      this.userStatus = cookie.serialize("status", String(this.user.status), cookieOptions);
      this.next();
    },
    fetchUser: function() {
      var self = this;
      models.users.findOne({username: this._body.username}, function(err, user){
        if(err) return self.error(err);
        self.user = user;
        self.next(user);
      });
    },
    passwordAuthenticates: function() {
      var password = this._body.password;
			this.user.comparePassword(password, (err, isMatch) => {
			 err ? this.error(err) : this.next(!!isMatch && isMatch === true);
			});
    },
    methodIsGet: function() {
      this.next(this._eventMethod == "get");
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
          "Set-Cookie": [ this.cookieToken, this.cookieUserId, this.userStatus ]
  			}
  		});
    },
    userDoesntExist: function(user) {
      this.next(!user);
    }
  },
  instruct: [
    { 
      if: "methodIsGet",
      true: ["renderLoggedOut", "serve"]
    },
    "fetchUser",
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
      this.cookieUserStatus = cookie.serialize("status", "", cookieOptions);
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
          "Set-Cookie": [ this.cookieToken, this.cookieUserId, this.cookieUserStatus ]
  			}
  		});   
    }
  },
  instruct: [
    "createLogoutCookies",
    "sendLogout"
  ]
});
global.plaid = new Chain({
  steps: {
    initPlaid: function() {
      if(this.plaidClient) {
        this.next();
        return;
      }
      
      var pClient = process.env.PLAIDCLIENT,
          pKey = process.env.PLAIDKEY;
          
      var configuration = new Configuration({
        basePath: PlaidEnvironments.sandbox,
        baseOptions: {
          headers: {
            "PLAID-CLIENT-ID": pClient,
            "PLAID-SECRET": pKey
          }
        }
      });
      
      this.plaidClient = new PlaidApi(configuration);
      
      this.next();
    },
    callPlaidMethod: function() {
      var method = this._arg2;
      
      this.plaidClient[method](this._body).then(res => {
        this.next(res.data);
      }).catch(e => {
        this.next({ plaidError: e.response.data });
      });
    },
    sendAccessToken: function() {
      const { public_token } = this._body;
      
      this.plaidClient.itemPublicTokenExchange({ public_token }).then(r => {
        this.next(r.data);
      }).catch(e => {
        this.next({ plaidError: e.response.data });
      });
    },
    sendLinkToken: function() {
      var b = this._body,
          products = b.products || ["auth", "identity"];
          
      const request = {
        user: { client_user_id: b.userId },
        client_name: b.siteName,
        products: products,
        language: "en",
        country_codes: ["US"],
        // link_customization_name: "account_selection_v2_customization",
        // update: { account_selection_enabled: true }
      };
      
      if(b.accessToken) {
        delete request.products;
        request.access_token = b.accessToken;
      }
      
      this.plaidClient.linkTokenCreate(request).then(r => {
        this.next(r.data);
      }).catch(e => {
        this.next({ plaidError: e.response.data });
      });
    },
    toPlaidMethod: function() {
      this.next(this._arg1);
    }
  },
  instruct: [
    "initPlaid",
    {
      switch: "toPlaidMethod",
      fetch: "callPlaidMethod",
      getLinkToken: "sendLinkToken",
      getAccessToken: "sendAccessToken"
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
    fetchSite: function() {
      var self = this,
          filter = { name: this._siteName };
      models.sites.findOne(filter).then(function(siteObj){
        if(siteObj) self.siteObj = siteObj;
        self.next(siteObj);
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
    fetchUsersPermitsForSite: function() {
      var self = this;
      permits.find({
        siteId: this.siteId,
        username: { $in: ["public", this.user.username] }
      }, function(err, foundPermits){
        if(err || !foundPermits) return self.error(err);
        
        self.permits = foundPermits;
        
        self.next();
      });
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
        syncDb: this.siteObj.syncDb,
        htmlButton: this.siteObj.htmlButton,
        scripts: this.siteObj.scripts
      };
      var self = this,
          dataNames = ["sheets", "permits", "siteData"],
          removeJs = function(scripts) {
            for(var i=0; i<scripts.length; i++) {
              var script = scripts[i],
                  name = script.name;
              if(name.excludes(".html") && name.excludes(".css")) {
                scripts.splice(i,1);
                i--;
              }
            }
          },
          dataScripts = dataNames.map(function(dataName) {
            // remove js keep html and css
            if(self[dataName]) {
              
              if(dataName=="sheets") {
                for(var s=0; s<self.sheets.length; s++) {
                  var sheet = self.sheets[s];
                  removeJs(sheet.ui.scripts);
                }
                return `var ${dataName} = ${JSON.stringify(self[dataName])};`;
              }
              
              if(dataName=="siteData") {
                removeJs(self.siteData.scripts);
              }
              
              return `var ${dataName} = ${JSON.stringify(self[dataName])};`;
            }
          });
          
      this.end({
        body: dataScripts.join("\n"),
  		  headers:{
  		    "Access-Control-Allow-Origin": "*",
  		    "Cache-Control": "max-age=31536000"
  		  },
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
    		  headers:{
    		    "Access-Control-Allow-Origin": "*",
    		    "Cache-Control": "max-age=31536000"
    		  },
          type: this.scriptType,
          data: this.data
        });
      }
    },
    sendSiteJson: function() {
      this.next({
        site: this.siteObj,
        sheets: this.sheets,
        permits: this.permits,
        user: this.user
      });
    },
    toScriptType: function() {
      this.next(this.scriptType);
    }
  },
  instruct: [
    "fetchSite",
    "fetchUsersPermitsForSite",
    "_fetchSheetForEachPermit",
    "_fetchMasterSite",
    {
      switch: "toScriptType",
      json: "sendSiteJson",
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
		    "Cache-Control": "no-cache"
		  },
		  statusCode: 200
		}
  },
  steps: {
    addContentTypeToHeaders: function(res) {
      if(res.type || res["Content-Type"]) {
        this.format.headers["Content-Type"] = res.type || res["Content-Type"];  
      }
      this.next(res.body || "// <(-_-)> Empty, your body content is.");
    },
    addBodyToFormatObj: function(res) {
      this.format.body = res;
      this.next();
    },
    assignCustomHeadersObj: function(res) {
      this.format.headers = res.headers;
      this.next(res);
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
    sendToClient: function() {
      this._callback(null, this.format);
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
    	      true: ["assignCustomHeadersObj", "addContentTypeToHeaders"],
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
      var apiInstance = new this.SibApiV3Sdk.ContactsApi();
      
      apiInstance.createContact(this.createContact).then( (data) => {
        this.next(data);
      }).catch((error) => {
        this.error(error);
      });
    },
    formatContactBody: function() {
      this.createContact = new this.SibApiV3Sdk.CreateContact();
      
      var formats = {
        sms: function(numb) {
          if(!numb) return;
          
          var firstChar = numb.slice(0,1);
          
          if(firstChar !== "1") numb = "1"+numb;
          
          return numb;
        }
      };
      
      var attrs = this._body.attributes || {};
      
      for(var key in attrs) {
        var value = attrs[key];
        if(formats[key]) {
          attrs[key] = formats[key](value);
        }
      }
      
      for(var prop in this._body) {
        this.createContact[prop] = this._body[prop];
      }
      
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
          message: "API called successfully. Returned data:",
          data: data
        });
      }, function(error) {
        self.next({
          error: "<(-_-)>" + error
        });
      });
    },
    sendHtmlEmail: function() {
      var self = this;
      
      for(var key in this._body) {
        this.sendSmtpEmail[key] = this._body[key];
      }
      
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
      "formatContactBody",
      "contactSave"
    ],
    emailHtml: [
      "BuildSibApi",
      "buildEmailInstance",
      "sendHtmlEmail"
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
global.usps = new Chain({
  input: function() {
    return {
      endpoint: "http://production.shippingapis.com/ShippingAPI.dll?",
      uspsMethod: this._arg1
    };
  },
  steps: {
    buildEstimatePath: function() {
      this.path = "API=RateV4&XML=";
      this.xml = `<RateV4Request USERID="${process.env.USPSID}">${this._body.xml}</RateV4Request>`;
      this.next();
    },
    buildValidatePath: function() {
      this.path = "API=Verify&XML=";  
      this.xml = `<AddressValidateRequest USERID="${process.env.USPSID}">${this._body.xml}</AddressValidateRequest>`;
      this.next();
    },
    buildUrl: function() {
      this.url = this.endpoint+this.path+this.xml.replace(/(\r\n|\n|\r)/gm, "").replaceAll("&", "&amp;");
      this.next();
    },
    fetchUsps: function() {
      nodeFetch(this.url, { method: "get" }).then(res => res.text()).then(t => this.next(t));
    },
    toUspsMethod: function() {
      this.next(this.uspsMethod);
    }
  },
  instruct: {
    switch: "toUspsMethod",
    estimate: ["buildEstimatePath", "buildUrl", "fetchUsps"],
    validate: ["buildValidatePath", "buildUrl", "fetchUsps"]
  }
});
global.easypost = new Chain({
  input: function() {
    return {
      poMethod: this._arg1
    };
  },
  steps: {
    bodyHasId: function() {
      this.next(!!this._body.shipment_id);
    },
    buildAddress: function() {
      var prop = Object.keys(this._body).includes("to") ? "to" : "from";
      var body = this._body[prop] || this._body;
      var address = new this.api.Address(body);
      
      address.save().then( addr => {
      delete this._body[prop];
      this._body[prop+"_address"] = addr;
      this.next(addr);
      });
    },
    buildParcel: function() {
      var parcel = new this.api.Parcel(this._body.parcel);
      parcel.save().then( p => {
        this._body.parcel = p;
        this.next(p);
      });
    },
    buildShipment: function(addr) {
      const b = this._body;
      const toAddress = b.to_address;
      const fromAddress = b.from_address;
      const parcel = b.parcel;
      
      const shipment = new this.api.Shipment({
        to_address: toAddress,
        from_address: fromAddress,
        parcel: parcel
      });
        
      shipment.save().then( r => {
        this.next({
          shipment: r,
          toAddress: toAddress,
          fromAddress: fromAddress,
          parcel: parcel
        });
      });
    },
    initPoApi: function() {
      this.api = new EasyPost(process.env.EASYPOSTKEY);
      this.next();
    },
    fetchSmartRates: function(res) {
      var id = this._body.shipment_id;
      this.api.Shipment.retrieve(id).then(s => {
        s.getSmartrates().then(this.next);
      });
    },
    createOrder: function() {
      var body = this._body;
      var props = ["from_address", "to_address"];
      var input = {};
      
      props.forEach(prop => {
        var value = body[prop] || "";
        value = value.id || value;
        input[prop] = value;
      });
      
      input.shipments = body.shipments.map( shpmnt => {
        return new this.api.Shipment({
          parcel: shpmnt
        });
      });

      
      var order = new this.api.Order(input);
      order.save().then( Order => {
        this.next(Order);
      });
    },
    purchaseTheOrder: function(order) {
      // this.next({
      //   order: order,
      //   carrier: this._body.carrier,
      //   service: this._body.service
      // });
      order.buy(this._body.carrier, this._body.service).then(res => {
        this.next(res);
      }).catch(e => {
        this.next(e);
      });
    },
    retrieveAddress: function() {
      this.api.Address.retrieve(this._body.id).then(res => {
        this.next(res);
      });
    },
    retrieveOrder: function() {
      this.api.Order.retrieve(this._body.id).then(res => {
        this.next(res);
      });
    },
    retrieveShipment: function() {
      
    },
    toPoMethod: function() {
      this.next(this.poMethod);
    }
  },
  instruct: [ "initPoApi", {
    switch: "toPoMethod",
    address: "buildAddress",
    getAddress: "retrieveAddress",
    order: [
      "createOrder"
    ],
    getOrder: "retrieveOrder",
    getShipment: "retrieveShipment",
    parcel: "buildParcel",
    purchaseOrder: [
      "retrieveOrder", "purchaseTheOrder"
    ],
    estimate: [
      "buildAddress",
      "buildAddress",
      "buildParcel",
      "buildShipment"
    ],
    smart: "fetchSmartRates"
  }]
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
      var index = Object.assign({}, this._memory.storage),
          removers = [
            "callback", 
            "brainAuth", 
            "brainPublic", 
            "brainPrivate", 
            "brainHeaders"
          ];
          
      removers.forEach(function(r){
        delete index[r];
      });
      
      next(index);
    },
    askingForLoginPage: function() {
      var params = this._event.pathParameters || {},
          site = params.site,
          chain = this._chain || "",
          chainIsNotAskingForScripts = ["scripts", "login", "signup"].excludes(chain);
          
      this.next(site == "login" && chainIsNotAskingForScripts);
    },
    fetchSimpleSite: function(res) {
      var self = this,
          filter = { name: this._siteName };

      models.sites.findOne(filter, "-scripts" , function(err, siteObj){
        if(siteObj) {
          self.siteObj = siteObj;
          self.siteId = siteObj._id;
        }
        self.next(siteObj);
      });
    },
    fetchUserFromCookie: function() {
      var self = this;
      this.userid = this._cookies.userid;
      models.users.findById(this.userid, function(err, user){
        if(err) return self.error(err);
        if(!user) return self.error("<(-_-)> Not existing in archives, user "+ self.userid +" is.");
        self.user = user;
        self.next();
      });
    },
    getSiteName: function() {
      var domainArray = this._domain.split(".");
      this._siteName = domainArray.length === 2 ? domainArray[0] : domainArray[1];
      this.next();
    },
    isVerbose: function(res, next) {
      next(this._query._verbose);
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
        type: "text/html"
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
      var genericSiteNames = ["uisheet.com", "amazonaws.com"],
          domain = this._domain,
          includesGeneric = 0;
          
      genericSiteNames.forEach(genericSite => {
        if(!includesGeneric && domain.includes(genericSite)) includesGeneric++;
      });
      
      this.next(includesGeneric==0);
    }
  },
  instruct: [
    "connectToDb",
    { 
      if: "usingCustomDomain",
      true: [
        "getSiteName", 
        {
          if: "askingForLoginPage",
          true: ["renderLoggedOut", "serve"]
        }
      ]
    }, // remove this when not using custom domain yet
    {
      if: "userHasCookies",
      true: [
        "fetchUserFromCookie",
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
    "fetchSimpleSite",
    { if: "noSiteExists", true: [ "renderNoSiteExists", "serve" ] },
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
          self.next({
            bulky: "Success",
            doc: doc
          });
        });
      }
    },
    instruct: [
      "connectToDb",
      { if: "usingCustomDomain", true: "getSiteName" },
      { if: "userHasCookies", true: "fetchUserFromCookie" },
      "fetchSimpleSite",
      "_buildModel",
      "postBulkItems",
      "serve"
    ]
  }).start(input).catch(function(error){
    handleError(callback, error);
  });
};

module.exports.port = function(event, context, callback) {
  
  if (event.source === "serverless-plugin-warmup") {
    console.log("<(-_-)> WarmUp - Lambda is warm!");
    return callback(null, "Lambda is warm!");
  }
  
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

function addMethodToArray(name, fn) {
  Object.defineProperty(Array.prototype, name, {
    enumerable: false,
    writable: true,
    value: fn
  });
}
function itemMatches(item, filter) {
  for(var key in filter) {
    if(filter[key] && filter[key] !== item[key]) return false;
  }
  return true; 
}
addMethodToArray("find", function(filter){
  var match = [];
  for (var i = 0; i<this.length; i++) {
    if(itemMatches(this[i], filter)) match.push(this[i]);
  }
  return match;
});
addMethodToArray("findOne", function(filter){
  var match = null;
  for (var i = 0; i<this.length; i++) {
    if(itemMatches(this[i], filter)) {
      match = this[i];
      match.i = i;
      i = this.length;
    }
  }
  return match;
});
addMethodToArray("excludes", function(keyword){
  return this.indexOf(keyword) == -1;
});
addMethodToArray("loop", function(fn, o) {
  if(fn === undefined) return console.log("Please define fn.");
  if(this === undefined) return console.log("Please define array");
  o = o || {
    then: function(fn) {
      if(!this.resolve) this.resolve = fn;
    }
  };
  o.i === undefined ? o.i = 0 : o.i++;
  if(!this[o.i]) {
    if(o.resolve) o.resolve();
    return o;
  }
  var self = this;
  fn(o.i, this[o.i], function() {
    setTimeout(function(){
      self.loop(fn, o);
    }, 0);
  });
  return o;
});
addMethodToArray("sortByProp", function(prop, descend){
  this.sort(function(a, b) {
    var sorted = a[prop] > b[prop];
    if(descend) {
      return sorted ? -1 : 1;
    }
    return  sorted ? 1 : -1; 
  });
});
if(!Object.loop) {
  Object.loop = function(obj, fn, parent) {
    parent = parent || obj;
    
    for(var key in obj) {
      var val = obj[key];
      
      if(Array.isArray(val)) {
        for(var i=0; i<val.length; i++) {
          if(val[i] !== undefined) {
           var item = val[i];
           typeof item == "object"
              ? Object.loop(item, fn, parent)
              : fn(val, i, item, parent);
          }
        }
      } else if(typeof val === "object" && Object.keys(val).length) {
        Object.loop(val, fn, parent);
      } else {
        fn(obj, key, val, parent); 
      }
    }
    
    return obj;
  };
}
if(!Object.matches) {
  Object.matches = function(obj1, obj2) {
    var obj1Keys = Object.keys(obj1),
        obj2Keys = Object.keys(obj2),
        shallowKeysMatch = JSON.stringify(obj1Keys) == JSON.stringify(obj2Keys);
    if(!shallowKeysMatch) return false;
    var obj1Data = "";
    Object.loop(obj1, function(obj, key, value){
      obj1Data += (key+(value.name || value))+typeof value;
    });
    var obj2Data = "";
    Object.loop(obj2, function(obj, key, value){
      obj2Data += (key+(value.name || value))+typeof value;
    });
    return obj1Data == obj2Data;
  };
}
function section(arr, n) {
  if ( !arr.length ) return [];
  n = n || Math.round(arr.length/2);
  return [ arr.slice( 0, n ) ].concat( section(arr.slice(n), n) );
}
const emptyObj = function(obj) {
  Object.loop(obj, function(o, key){
    o[key] = "";
  });
  return obj;
};
var obj = function(o) {
  for (var key in o) {
  	if(o[key] !== undefined) this[key] = o[key];
  }
};
obj.prototype.loop = Object.loop;
function loop(arr) {
  return { async: arr };
}
function proper(str) {
  if (str === 0) str = "0";
  if (!str) return "";
  str = str.toString();
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}
function renameProp(obj, oldProp, newProp) {
  var newObj = {};
  for(var key in obj) {
    if(key == oldProp) {
      newObj[newProp] = obj[key];
    } else {
      newObj[key] = obj[key];
    }
  }
  return newObj;
}
var typeTimer = 0;
function whenTypingStops(fn) {
  clearTimeout(typeTimer);
  typeTimer = setTimeout(function () {
    fn();
  }, 500);
}
if (!String.prototype.includes) {
  String.prototype.includes = function() {
    "use strict";
    return String.prototype.indexOf.apply(this, arguments) !== -1;
  };
}
if (!String.prototype.excludes) {
  String.prototype.excludes = function() {
    "use strict";
    return String.prototype.indexOf.apply(this, arguments) === -1;
  };
}
function percentage(number, digits) {
  digits = digits || 0;
  return (number*100).toFixed(digits) + "%";
};
function phone(val) {
  var input = (val || "").toString().replace(/[^\d]*/g, "");
  return input.replace(/(\d{3})(\d{3})(\d{4}).*/g, "($1) $2-$3");
}
function price(value) {
  if((value*1).toFixed(2) === "NaN" || !value) value = 0;
  value = (value*1).toFixed(2);
  value = value.toString().split(".");
  value[0] = value[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  value = value.join(".");
  return "$" + value;
}

var add = function(arr, notFixed) {
  if(!arr) return 0;
  if(!Array.isArray(arr)) return arr;
  var total = 0;
  for (var i=0; i<arr.length; i++) {
    var num = arr[i];
    if (!!num) {
    if(Array.isArray(num)) {
      total += add(num);
    } else {
      if(isNaN(num)) {
        num = num.replace("$", "");
        num = num.replace(",", "");
      }
      if(!isNaN(num)) total += (num*1);
    }
    }
  }
  return notFixed ? total : total.toFixed(2);
}

function addEvent(el, type, fn) {
  if (el.addEventListener)
    el.addEventListener(type, fn, false);
	else
		el.attachEvent('on'+type, fn);  
}

function CSVToArrays(stringData, strDelimiter) {
  strDelimiter = strDelimiter || ",";
  var objPattern = new RegExp((
  // Delimiters.
  "(\\" + strDelimiter + "|\\r?\\n|\\r|^)" +
  // Quoted fields.
  "(?:\"([^\"]*(?:\"\"[^\"]*)*)\"|" +
  // Standard fields.
  "([^\"\\" + strDelimiter + "\\r\\n]*))"), "gi");
  var arrData = [[]];
  var arrMatches = null;
  while (arrMatches = objPattern.exec(stringData)) {
    var strMatchedDelimiter = arrMatches[1];
    if (strMatchedDelimiter.length && (strMatchedDelimiter != strDelimiter)) {
      arrData.push([]);
    }
    if (arrMatches[2]) {
      var strMatchedValue = arrMatches[2].replace(
      new RegExp("\"\"", "g"), "\"");
    } else {
      var strMatchedValue = arrMatches[3];
    }
    arrData[arrData.length - 1].push(strMatchedValue);
  }
  return (arrData);
}

function convertCsvToJson(csv, delimeter) {
  var array = CSVToArrays(csv, delimeter);
  var objArray = [];
  for (var i = 1; i < array.length; i++) {
    objArray[i - 1] = {};
    for (var k = 0; k < array[0].length && k < array[i].length; k++) {
      var key = array[0][k];
      objArray[i - 1][key] = array[i][k]
    }
  }
  return objArray;
}

if (!String.prototype.includes) {
  String.prototype.includes = function() {
    'use strict';
    return String.prototype.indexOf.apply(this, arguments) !== -1;
  };
}
if (!String.prototype.excludes) {
  String.prototype.excludes = function() {
    'use strict';
    return String.prototype.indexOf.apply(this, arguments) === -1;
  };
}

if (typeof String.prototype.parseFunction != "function") {
  String.prototype.parseFunction = function () {
    var funcReg = /function *\(([^()]*)\)[ \n\t]*{(.*)}/gmi;
    var match = funcReg.exec(this.replace(/\n/g, " "));
    if(match) {
      return new Function(match[1].split(","), match[2]);
    }
    return null;
  };
}

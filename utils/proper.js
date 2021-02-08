module.exports = function(str) {
  if (str === 0) str = "0";
  if (!str) return "";
  str = str.toString();
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
};

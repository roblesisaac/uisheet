const proper = require("./utils/proper");

module.exports = function(page, props) {
  const siteName = props._siteName || "uisheet";
  const windowLocation = props._host;
  const stamp = (props.siteObj || {}).cacheStamp || Date.now();
  const userid = props.userid || "";
  const blend = function(str1, str2) {
    var blended = "";
    str1 = str1.toString().split("");
    str2 = str2.toString().split("");
    str1.forEach(function(char, i){
      var otherChar = str2[i] || "";
      blended += (char+otherChar);
    });
    return blended;
  };
  const cacheStamp = userid == "" ? stamp : blend(userid, stamp);
  return `<!DOCTYPE html>
<html>
  <head>
    <title>${proper(props._siteName || page)}</title>
    <meta http-equiv="x-ua-compatible" content="ie=edge">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1" />
    <meta charset="utf-8" />
    <meta name="theme-color">
    <link rel="icon" type="image/png" href="https://uisheet.s3-us-west-1.amazonaws.com/${siteName}/favicon.png">
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/foundation/6.6.3/css/foundation-float.min.css" />
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/foundation/6.6.3/css/foundation.min.css">
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/foundicons/3.0.0/foundation-icons.min.css" />
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/motion-ui/2.0.3/motion-ui.min.css" integrity="sha512-JS71dBXAy3tO3oxhBhOgVR3OwEqjlt7dwxhC5i2jIDUZ2P4H9E1IAvqEV9V0ZgrKhOgqluaQgYfoOjDUPCdMbw==" crossorigin="anonymous" referrerpolicy="no-referrer" />
    <link rel="stylesheet" href="https://fonts.googleapis.com/icon?family=Material+Icons">
    <link href="https://fonts.googleapis.com/css?family=Work+Sans:900|Lobster" rel="stylesheet">
    <link href="https://fonts.googleapis.com/css?family=Coda:800|Maven+Pro:900" rel="stylesheet">
    <link href="https://fonts.googleapis.com/css?family=Roboto+Mono" rel="stylesheet">
    <link rel="stylesheet" href="${windowLocation}/scripts/css/${cacheStamp}">
    <style id="siteStyles"></style>
    <style id="sheetStyles"></style>
  </head>
  
  <body>
    <div id="root"></div>
  </body>
  
  <script src="https://code.jquery.com/jquery-3.2.1.min.js"></script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/babel-polyfill/6.23.0/polyfill.min.js"></script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/foundation/6.6.3/js/foundation.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/vue@2.6.12"></script>
  
  <script type="text/javascript">
    const globalScript = {};
    let page = "ui-${page}";
    const siteName = "${props._siteName}";
    const scripts = {};
    const user = ${ JSON.stringify(props.user) };
    //test
  </script>
  
  <script src="${windowLocation}/scripts/data/${cacheStamp}"></script>
  <!-- <script src="${windowLocation}/scripts/js/${cacheStamp}"></script> -->
  
  <script src="https://www.uisheet.com/uisheet/scripts/js"></script>
  
  <script defer src="https://cdnjs.cloudflare.com/ajax/libs/ace/1.4.12/ace.min.js"></script>
  <script defer src="https://cdnjs.cloudflare.com/ajax/libs/ace/1.4.12/ext-language_tools.min.js"></script>  
  <script defer src="https://cdnjs.cloudflare.com/ajax/libs/xlsx-populate/1.21.0/xlsx-populate-no-encryption.min.js" integrity="sha512-vTcH2/smkURtorUy2Lj/if8X2Mlcs17/d+PqDkTSPSVx5HcxQLVgdQixETp4fPihMhyvG8pNKAbHa/CM8n4/NA==" crossorigin="anonymous" referrerpolicy="no-referrer"></script>
  <script defer src="https://cdn.plaid.com/link/v2/stable/link-initialize.js"></script>
  <script defer src="https://cdnjs.cloudflare.com/ajax/libs/jspdf/1.3.5/jspdf.min.js"></script>
  <script defer src="https://js.braintreegateway.com/web/3.72.0/js/client.min.js"></script>
  <script defer src="https://js.braintreegateway.com/web/3.72.0/js/data-collector.min.js"></script>
  <script defer src="https://js.braintreegateway.com/web/dropin/1.26.0/js/dropin.min.js"></script>
</html>
  `;
};

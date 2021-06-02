const proper = require("./utils/proper");

module.exports = function(page, props) {
  const siteName = props.sheets.length === 0
                    ? "uisheet"
                    : props._siteName || "uisheet";
  const windowLocation = props._host;
  const cacheStamp = (props.siteObj || {}).cacheStamp || Date.now();
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
    <link rel="stylesheet" href="https://fonts.googleapis.com/icon?family=Material+Icons">
    <link href="https://fonts.googleapis.com/css?family=Work+Sans:900|Lobster" rel="stylesheet">
    <link href="https://fonts.googleapis.com/css?family=Coda:800|Maven+Pro:900" rel="stylesheet">
    <link href="https://fonts.googleapis.com/css?family=Roboto+Mono" rel="stylesheet">
    <link rel="stylesheet" href="${windowLocation}/scripts/css">
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
  <script src="https://cdnjs.cloudflare.com/ajax/libs/ace/1.4.12/ace.min.js"></script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/ace/1.4.12/ext-language_tools.min.js"></script>
  
  <script type="text/javascript">
    const globalScript = {};
    let page = "ui-${page}";
    const siteName = "${props._siteName}";
    const scripts = {};
    const user = ${ JSON.stringify(props.user) };
  </script>
  
  <script src="${windowLocation}/scripts/data/${cacheStamp}"></script>
  <script src="${windowLocation}/scripts/js/${cacheStamp}"></script>

  <script defer src="https://js.braintreegateway.com/web/3.72.0/js/client.min.js"></script>
  <script defer src="https://js.braintreegateway.com/web/3.72.0/js/data-collector.min.js"></script>
  <script defer src="https://js.braintreegateway.com/web/dropin/1.26.0/js/dropin.min.js"></script>
</html>
  `;
};

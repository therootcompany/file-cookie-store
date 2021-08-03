# [@root/file-cookie-store](https://github.com/therootcompany/file-cookie-store)

Store cookies in Netscape-compatible (curl, wget, etc) format text files.

## Features

-   [x] Compatible with
        [tough cookie@4.x](https://github.com/goinstant/tough-cookie 'tough cookie').
-   [x] Netscape cookie file format, compatible with curl, wget, etc
-   [x] Parallel access to the cookies file (using
        [lockfile](https://github.com/npm/lockfile) library)

## Synopsis

```javascript
npm install --save tough-cookie@4
npm install --save @root/file-cookie-store@1
```

```javascript
let Cookie = require('tough-cookie');
var FileCookieStore = require('@root/file-cookie-store');

// Initialize
var cookies_store = new FileCookieStore('./cookie.txt', {
    auto_sync: false,
    lockfile: true
});
let jar = new Cookie.CookieJar(cookies_store);

// Promisify for async functions
jar.setCookieAsync = require('util').promisify(jar.setCookie);
jar.getCookiesAsync = require('util').promisify(jar.getCookies);
cookies_store.saveAsync = require('util').promisify(cookies_store.save);
```

## Usage

Class FileCookieStore has different properties:

-   force*parse - continue parse file and don't throw exception if bad line was
    found ( Default : \_false*)
-   lockfile - use lockfile for access to the cookies file ( Default : _true_)
-   mode - mode of new created file ( Default : _438_ aka 0666 in Octal)
-   http*only_extension - use http_only extension - prefix #HttpOnly* for http
    only cookies. Curl, FF, etc use this kind of entries ( Default : _true_)
-   lockfile*retries - attempts for lock file before throw exception ( Default :
    \_200*)
-   auto*sync - in this mode cookies rewrote to the file after every change. If
    you set auto_sync to the \_false*, you have to call method 'save' manually (
    Default : _true_).

Example of using FileCookieStore without auto_sync mode:

```javascript
var Q = require('q');
var FileCookieStore = require('@root/file-cookie-store');
var TOUGH = require("tough-cookie");

var cookies_store = new FileCookieStore("./cookie.txt", {auto_sync : false});
var jar = new TOUGH.CookieJar(cookies_store);

Q.nbind(jar.setCookie, jar)(new new TOUGH.Cookie({...}), 'http://test.com/')
.then(function () {
          return Q.nbind(jar.setCookie, jar)(new TOUGH.Cookie({...}), 'http://test.com/')
}).then(function () {
          return Q.nbind(cookies_store.save, cookies_store)();//save changes to the file
});
```

#### Export cookies

For receive all cookies from the store might be used method export:

```javascript
cookie_store.export(function (cookies) {
    //array cookies
});

cookie_store.export(new MemoryCookieStore(), function (memory_cookie_store) {
    //memory_cookie_store
});
```

#### Store file format

Cookies stored in
[Netscape's cookie.txt file](http://www.cookiecentral.com/faq/#3.5). This allow
import/export cookies into/from different browsers. And use with command-line
network tools: curl, wget, etc.

The layout of Netscape's cookies.txt file is such that each line contains one
name-value pair. An example cookies.txt file may have an entry that looks like
this:

.netscape.com TRUE / FALSE 946684799 NETSCAPE_ID 100103

Each line represents a single piece of stored information. A tab is inserted
between each of the fields.

From left-to-right, here is what each field represents:

-   domain - The domain that created AND that can read the variable.
-   flag - A TRUE/FALSE value indicating if all machines within a given domain
    can access the variable. This value is set automatically by the browser,
    depending on the value you set for domain.
-   path - The path within the domain that the variable is valid for.
-   secure - A TRUE/FALSE value indicating if a secure connection with the
    domain is needed to access the variable.
-   expiration - The UNIX time that the variable will expire on. UNIX time is
    defined as the number of seconds since Jan 1, 1970 00:00:00 GMT.
-   name - The name of the variable.
-   value - The value of the variable.

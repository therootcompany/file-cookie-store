'use strict';

var fs = require('fs');
var UTIL = require('util');
var Q = require('q');
var TOUGH = require('tough-cookie');
var canonicalDomain = TOUGH.canonicalDomain;
var permuteDomain = TOUGH.permuteDomain;
var permutePath = TOUGH.permutePath;
var LOCKFILE = require('lockfile');

function isString(str) {
    return typeof str === 'string' || str instanceof String;
}

function noop() {}

function lockFileName(file_name) {
    return file_name + '.lock';
}

function FileCookieStore(file, opt) {
    opt = opt || {};
    this.file = file;
    this.force_parse = opt.hasOwnProperty('force_parse')
        ? opt.force_parse
        : false;
    this.lockfile = opt.hasOwnProperty('lockfile') ? opt.lockfile : true;
    this.mode = opt.hasOwnProperty('mode') ? opt.mode : 438;
    this.http_only_extension = opt.hasOwnProperty('http_only_extension')
        ? opt.http_only_extension
        : true;
    this.lockfile_retries = opt.hasOwnProperty('lockfile_retries')
        ? opt.lockfile_retries
        : 200;
    this.auto_sync = opt.hasOwnProperty('auto_sync') ? opt.auto_sync : true;
    this.no_file_error = opt.hasOwnProperty('no_file_error')
        ? opt.no_file_error
        : false;

    if (!this.file || !isString(this.file)) {
        throw new Error('Unknown file for read/write cookies');
    }

    if (!fs.existsSync(this.file)) {
        fs.writeFileSync(this.file, '');
    }

    this.idx = {};
}

UTIL.inherits(FileCookieStore, TOUGH.Store);

FileCookieStore.prototype.idx = null;
FileCookieStore.prototype.synchronous = true;

FileCookieStore.prototype.inspect = function () {
    return '{ idx: ' + UTIL.inspect(this.idx, false, 2) + ' }';
};

FileCookieStore.prototype._readFile = function (cb) {
    var data = null;

    try {
        data = fs.readFileSync(this.file, 'utf8');
    } catch (e) {
        if (e.code === 'ENOENT') {
            fs.writeFileSync(
                this.file,
                '# Netscape HTTP Cookie File\n' +
                    '# http://www.netscape.com/newsref/std/cookie_spec.html\n' +
                    '# This is a generated file!  Do not edit.\n\n'
            );
        }
    }

    this.readed = true;
    if (!data) {
        return cb(null);
    }

    var err = null;
    try {
        this.deserialize(data);
    } catch (e) {
        err = e;
    }

    cb(err);
};

FileCookieStore.prototype._read = function (cb) {
    this._readFile(cb);
};

FileCookieStore.prototype._get_lock_func = function (disable_lock) {
    var lock_file = lockFileName(this.file);

    if (!disable_lock && this.lockfile) {
        LOCKFILE.lockSync(lock_file);
    }
};

FileCookieStore.prototype._get_unlock_func = function (disable_lock) {
    var lock_file = lockFileName(this.file);
    if (!disable_lock && this.lockfile) {
        LOCKFILE.unlockSync(lock_file);
    }
};

FileCookieStore.prototype._write = function (options, cb) {
    var data = this.serialize(this.idx),
        err = null;

    options = options || {};
    cb = cb || noop;

    this._get_lock_func(options.disable_lock);
    try {
        fs.writeFileSync(this.file, data, { mode: this.mode });
    } catch (e) {
        err = e;
    }

    cb(err);

    this._get_unlock_func(options.disable_lock);
};

FileCookieStore.prototype._update = function (updateFunc, cb) {
    var err = null;
    this._get_lock_func(!this.auto_sync); // the file must be locked while auto_sync is true.
    this._read(function (e) {
        // TODO is this synchrous?
        if (e) {
            err = e;
        }
    });

    if (err) {
        cb(err);
        return this._get_unlock_func(!this.auto_sync);
    }

    updateFunc();
    if (this.auto_sync) {
        this._write({ disable_lock: true }, function (e) {
            // okay because _write is sync
            if (e) {
                err = e;
            }
        });
    }

    cb(err);
    this._get_unlock_func(!this.auto_sync);
};

FileCookieStore.prototype.serialize = function (idx) {
    var data =
        '# Netscape HTTP Cookie File\n' +
        '# http://www.netscape.com/newsref/std/cookie_spec.html\n' +
        '# This is a generated file!  Do not edit.\n\n';

    for (var domain in idx) {
        if (!idx.hasOwnProperty(domain)) {
            continue;
        }
        for (var path in idx[domain]) {
            if (!idx[domain].hasOwnProperty(path)) {
                continue;
            }
            for (var key in idx[domain][path]) {
                if (!idx[domain][path].hasOwnProperty(key)) {
                    continue;
                }
                var cookie = idx[domain][path][key];
                if (cookie) {
                    var cookie_domain = cookie.domain;
                    if (!cookie.hostOnly) {
                        cookie_domain = '.' + cookie_domain;
                    }
                    var line =
                        [
                            this.http_only_extension && cookie.httpOnly
                                ? '#HttpOnly_' + cookie_domain
                                : cookie_domain,
                            /^\./.test(cookie_domain) ? 'TRUE' : 'FALSE',
                            cookie.path,
                            cookie.secure ? 'TRUE' : 'FALSE',
                            cookie.expires && cookie.expires !== 'Infinity'
                                ? Math.round(cookie.expires.getTime() / 1000)
                                : 0,
                            cookie.key,
                            cookie.value
                        ].join('\t') + '\n';
                    data += line;
                }
            }
        }
    }
    return data;
};

/**
 *
 * @param {String} raw_data
 * @throws {Error} will throw error if file invalid and force_parse - false
 * @returns {Array}
 */
FileCookieStore.prototype.deserialize = function (raw_data) {
    var data_by_line = raw_data.split(/\r\n|\n/),
        self = this,
        line_num = 0,
        parsed,
        http_only = false,
        magic = data_by_line.length ? data_by_line[0] : '';

    if (
        (!magic || !/^\#(?: Netscape)? HTTP Cookie File/.test(magic)) &&
        !self.force_parse
    ) {
        throw new Error(
            this.file + ' does not look like a netscape cookies file'
        );
    }

    data_by_line.forEach(function (line) {
        ++line_num;
        if (
            !(
                /^\s*$/.test(line) ||
                (/^\s*\#/.test(line) && !/^#HttpOnly_/.test(line))
            )
        ) {
            if (self.http_only_extension && /^#HttpOnly_/.test(line)) {
                http_only = true;
                line = line.replace(/^#HttpOnly_(.*)/, '$1');
            } else {
                http_only = false;
            }

            parsed = line.split(/\t/);
            if (parsed.length !== 7) {
                if (!self.force_parse) {
                    throw new Error('Line ' + line_num + ' is not valid');
                } else {
                    return;
                }
            }

            var domain = parsed[0],
                can_domain = canonicalDomain(domain);

            var cookie = new TOUGH.Cookie({
                domain: can_domain,
                path: parsed[2],
                secure: parsed[3] === 'TRUE' ? true : false,
                //expires : parseInt(parsed[4]) ? new Date(parsed[4] * 1000) : undefined,
                expires: parseInt(parsed[4])
                    ? new Date(parsed[4] * 1000)
                    : 'Infinity',
                key: parsed[5],
                value: parsed[6],
                httpOnly: http_only,
                hostOnly: /^\./.test(domain) ? false : true
            });

            self._addCookie(cookie);
        }
    });
};

FileCookieStore.prototype.save = function (cb) {
    this._write(null, cb);
};

FileCookieStore.prototype.findCookie = function (domain, path, key, cb) {
    var self = this;
    this._read(function (err) {
        if (err) {
            return cb(err);
        }
        var can_domain = canonicalDomain(domain);

        if (!self.idx[can_domain]) {
            return cb(null, undefined);
        }

        if (!self.idx[can_domain][path]) {
            return cb(null, undefined);
        }

        return cb(null, self.idx[can_domain][path][key] || null);
    });
};

FileCookieStore.prototype.findCookies = function (domain, path, _, cb) {
    var self = this,
        results = [];
    if (!domain) {
        return cb(null, []);
    }

    var can_domain = canonicalDomain(domain);
    this._read(function (err) {
        if (err) {
            return cb(err);
        }

        var pathMatcher;
        if (!path) {
            // null or '/' means "all paths"
            pathMatcher = function matchAll(domainIndex) {
                for (var curPath in domainIndex) {
                    if (domainIndex.hasOwnProperty(curPath)) {
                        var pathIndex = domainIndex[curPath];
                        for (var key in pathIndex) {
                            if (pathIndex.hasOwnProperty(key)) {
                                results.push(pathIndex[key]);
                            }
                        }
                    }
                }
            };
        } else if (path === '/') {
            pathMatcher = function matchSlash(domainIndex) {
                var pathIndex = domainIndex['/'];
                if (!pathIndex) {
                    return;
                }
                for (var key in pathIndex) {
                    if (pathIndex.hasOwnProperty(key)) {
                        results.push(pathIndex[key]);
                    }
                }
            };
        } else {
            var paths = permutePath(path) || [path];
            pathMatcher = function matchRFC(domainIndex) {
                paths.forEach(function (curPath) {
                    var pathIndex = domainIndex[curPath];
                    if (!pathIndex) {
                        return;
                    }
                    for (var key in pathIndex) {
                        results.push(pathIndex[key]);
                    }
                });
            };
        }

        var domains = permuteDomain(can_domain) || [can_domain];
        var idx = self.idx;
        domains.forEach(function (curDomain) {
            var domainIndex = idx[curDomain];
            if (!domainIndex) {
                return;
            }
            pathMatcher(domainIndex);
        });
        cb(null, results);
    });
};

FileCookieStore.prototype._addCookie = function (cookie) {
    var domain = cookie.canonicalizedDomain();
    if (!this.idx[domain]) {
        this.idx[domain] = {};
    }
    if (!this.idx[domain][cookie.path]) {
        this.idx[domain][cookie.path] = {};
    }
    this.idx[domain][cookie.path][cookie.key] = cookie;
};

FileCookieStore.prototype.putCookie = function (cookie, cb) {
    var self = this;

    this._update(function () {
        self._addCookie(cookie);
    }, cb);
};

FileCookieStore.prototype.updateCookie = function (oldCookie, newCookie, cb) {
    this.putCookie(newCookie, cb);
};

FileCookieStore.prototype.removeCookie = function (domain, path, key, cb) {
    var self = this;
    this._update(function () {
        var can_domain = canonicalDomain(domain);
        if (
            self.idx[can_domain] &&
            self.idx[can_domain][path] &&
            self.idx[can_domain][path][key]
        ) {
            delete self.idx[can_domain][path][key];
        }
    }, cb);
};

FileCookieStore.prototype.removeCookies = function (domain, path, cb) {
    var self = this;
    this._update(function () {
        var can_domain = canonicalDomain(domain);
        if (self.idx[can_domain]) {
            if (path) {
                delete self.idx[can_domain][path];
            } else {
                delete self.idx[can_domain];
            }
        }
    }, cb);
};

FileCookieStore.prototype.export = function (cookie_store, cb) {
    var self = this;
    if (arguments.length < 2) {
        cb = cookie_store;
        cookie_store = null;
    }
    if (!cookie_store) {
        cookie_store = [];
    }
    this._read(function (err) {
        if (err) {
            cb(err);
            return;
        }
        var fns = [];
        var idx = self.idx;
        for (var domain in idx) {
            if (!idx.hasOwnProperty(domain)) {
                continue;
            }
            for (var path in idx[domain]) {
                if (!idx[domain].hasOwnProperty(path)) {
                    continue;
                }
                for (var key in idx[domain][path]) {
                    if (!idx[domain][path].hasOwnProperty(key)) {
                        continue;
                    }
                    var cookie = idx[domain][path][key];
                    if (cookie) {
                        if (cookie_store instanceof TOUGH.Store) {
                            var func = Q.nbind(
                                cookie_store.putCookie,
                                cookie_store
                            );
                            fns.push(func(cookie));
                        } else {
                            cookie_store.push(cookie);
                        }
                    }
                }
            }
        }

        if (fns.length) {
            Q.all(fns)
                .then(function () {
                    cb(null, cookie_store);
                })
                .catch(function (err) {
                    cb(err);
                })
                .done();
        } else {
            cb(null, cookie_store);
        }
    });

    return cookie_store;
};

FileCookieStore.prototype.getAllCookies = function (cb) {
    this.export(function (err, cookies) {
        if (err) {
            cb(err);
        } else {
            cookies.sort(function (a, b) {
                return (a.creationIndex || 0) - (b.creationIndex || 0);
            });
            cb(null, cookies);
        }
    });
};

module.exports = FileCookieStore;

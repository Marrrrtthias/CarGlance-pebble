// Phone-side companion: owns the credentials, talks to the Pleos Vehicle Data
// API and pushes a compact summary to the watch.
var Clay = require('@rebble/clay');
var clayConfig = require('./config');

var clay = new Clay(clayConfig, null, { autoHandleEvents: false });

var API_BASE = 'https://api.pleos.ai';
var STORE_CONFIG = 'bp-config';
var STORE_TOKEN = 'bp-token';
var STORE_VEHICLE = 'bp-vehicle';

// Error codes that mean "get a new token and try again".
var TOKEN_ERRORS = [40002, 40003, 40004];

var busy = false;

// ---------------------------------------------------------------------------
// Storage helpers

function loadJSON(key) {
  try {
    var raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

function saveJSON(key, value) {
  if (value === null || value === undefined) {
    localStorage.removeItem(key);
  } else {
    localStorage.setItem(key, JSON.stringify(value));
  }
}

function getConfig() {
  var cfg = loadJSON(STORE_CONFIG) || {};
  return {
    brand: cfg.brand || 'hyundai',
    clientId: (cfg.clientId || '').trim(),
    clientSecret: (cfg.clientSecret || '').trim(),
    vin: (cfg.vin || '').trim().toUpperCase()
  };
}

// ---------------------------------------------------------------------------
// HTTP

function ApiError(message, code, httpStatus) {
  this.message = message;
  this.code = code;
  this.httpStatus = httpStatus;
}

function isTokenError(err) {
  return err instanceof ApiError &&
    (err.httpStatus === 401 || TOKEN_ERRORS.indexOf(Number(err.code)) !== -1);
}

function request(method, path, cfg, token, body, cb) {
  var xhr = new XMLHttpRequest();
  xhr.open(method, API_BASE + path, true);
  xhr.timeout = 20000;
  xhr.setRequestHeader('Brand', cfg.brand);
  xhr.setRequestHeader('Accept', 'application/json');
  if (body) {
    xhr.setRequestHeader('Content-Type', 'application/json');
  }
  if (token) {
    xhr.setRequestHeader('Authorization', 'Bearer ' + token);
  }
  xhr.onload = function () {
    var json = null;
    try {
      json = JSON.parse(xhr.responseText);
    } catch (e) {
      // Non-JSON body; handled below.
    }
    if (xhr.status >= 200 && xhr.status < 300 && json && json.data) {
      cb(null, json.data);
      return;
    }
    var apiErr = json && json.error;
    var msg = apiErr && apiErr.message ? apiErr.message : 'HTTP ' + xhr.status;
    console.log('API ' + method + ' ' + path + ' failed: ' + xhr.status + ' ' + xhr.responseText);
    cb(new ApiError(msg, apiErr && apiErr.code, xhr.status));
  };
  xhr.onerror = function () {
    cb(new ApiError('Network error'));
  };
  xhr.ontimeout = function () {
    cb(new ApiError('Request timed out'));
  };
  xhr.send(body ? JSON.stringify(body) : null);
}

function fetchToken(cfg, cb) {
  request('POST', '/v1/auth/personal-token', cfg, null,
    { clientId: cfg.clientId, clientSecret: cfg.clientSecret },
    function (err, data) {
      if (err) {
        if (err.httpStatus >= 400 && err.httpStatus < 500) {
          err.message = 'Login failed. Check Client ID, Secret and manufacturer.';
        }
        cb(err);
        return;
      }
      if (!data.accessToken) {
        cb(new ApiError('No access token'));
        return;
      }
      saveJSON(STORE_TOKEN, data.accessToken);
      cb(null, data.accessToken);
    });
}

// Performs an authorized GET, issuing a token when none is cached and
// retrying once with a fresh token when the cached one was rejected.
function authGet(cfg, path, cb) {
  var cached = loadJSON(STORE_TOKEN);
  function withToken(token, retry) {
    request('GET', path, cfg, token, null, function (err, data) {
      if (err && retry && isTokenError(err)) {
        saveJSON(STORE_TOKEN, null);
        fetchToken(cfg, function (tokErr, fresh) {
          if (tokErr) {
            cb(tokErr);
          } else {
            withToken(fresh, false);
          }
        });
        return;
      }
      cb(err, data);
    });
  }
  if (cached) {
    withToken(cached, true);
  } else {
    fetchToken(cfg, function (err, token) {
      if (err) {
        cb(err);
      } else {
        withToken(token, false);
      }
    });
  }
}

// ---------------------------------------------------------------------------
// Data mapping

function resolveVehicle(cfg, cb) {
  var cached = loadJSON(STORE_VEHICLE);
  if (cached && cached.vin && (!cfg.vin || cached.vin === cfg.vin)) {
    cb(null, cached);
    return;
  }
  authGet(cfg, '/v1/vehicles/consent', function (err, data) {
    if (err) {
      cb(err);
      return;
    }
    var vehicles = data.vehicles || [];
    var v = null;
    for (var i = 0; i < vehicles.length; i++) {
      if (!cfg.vin || vehicles[i].vin === cfg.vin) {
        v = vehicles[i];
        break;
      }
    }
    if (!v) {
      cb(new ApiError(cfg.vin ? 'VIN not found' : 'No vehicles'));
      return;
    }
    var vehicle = { vin: v.vin, name: v.nickname || v.sellname || v.name || v.vin };
    saveJSON(STORE_VEHICLE, vehicle);
    cb(null, vehicle);
  });
}

// 1 = all locked, 0 = closed but unlocked, 2 = a door is open, -1 = unknown
function lockState(status) {
  var states = [];
  (status.doors || []).forEach(function (row) {
    ['left', 'right'].forEach(function (side) {
      if (row[side] && row[side] !== 'invalid') {
        states.push(row[side]);
      }
    });
  });
  if (!states.length) return -1;
  if (states.indexOf('open') !== -1) return 2;
  return states.every(function (s) { return s === 'locked'; }) ? 1 : 0;
}

// The API serves the last data the car uploaded and can't ask the car for new
// data, so the watch shows how old it is. Returns the older of the given ISO
// timestamps (the screen is only as fresh as its oldest value) in epoch
// seconds, or -1 when none is valid.
function dataTime() {
  var oldest = -1;
  for (var i = 0; i < arguments.length; i++) {
    var t = arguments[i] ? new Date(arguments[i]).getTime() : NaN;
    if (!isNaN(t) && (oldest === -1 || t < oldest)) oldest = t;
  }
  return oldest === -1 ? -1 : Math.floor(oldest / 1000);
}

function buildPayload(vehicle, status, battery) {
  var charge = (battery && battery.charge) || {};
  var soc = typeof charge.stateOfCharge === 'number' ? Math.round(charge.stateOfCharge) : -1;
  return {
    STATUS: 'ok',
    NAME: vehicle.name,
    LOCKED: status ? lockState(status) : -1,
    PLUGGED: charge.plugin === 'connected' ? 1 : (charge.plugin === 'disconnected' ? 0 : -1),
    CHARGING: charge.charging ? 1 : 0,
    CHARGE_STATUS: charge.status || '',
    SOC: soc,
    REMAIN_MIN: typeof charge.remainTime === 'number' ? charge.remainTime : 0,
    DATA_TIME: dataTime(battery && battery.timestamp, status && status.timestamp)
  };
}

function demoPayload() {
  return buildPayload(
    { name: 'IONIQ 5 (demo)' },
    { doors: [{ left: 'locked', right: 'locked' }, { left: 'locked', right: 'locked' }] },
    {
      charge: { plugin: 'connected', status: 'charging', charging: true, stateOfCharge: 73.4, remainTime: 95 },
      timestamp: new Date(Date.now() - 7 * 60 * 1000).toISOString()
    });
}

// ---------------------------------------------------------------------------
// Watch communication

function send(payload) {
  Pebble.sendAppMessage(payload, function () {
    console.log('Sent ' + payload.STATUS);
  }, function (e) {
    console.log('Send failed: ' + JSON.stringify(e));
  });
}

function sendError(msg) {
  send({ STATUS: 'error', ERROR: String(msg).substring(0, 60) });
}

function refresh() {
  var cfg = getConfig();
  if (cfg.clientId.toLowerCase() === 'demo') {
    send(demoPayload());
    return;
  }
  if (!cfg.clientId || !cfg.clientSecret) {
    send({ STATUS: 'nocreds' });
    return;
  }
  if (busy) return;
  busy = true;

  resolveVehicle(cfg, function (err, vehicle) {
    if (err) {
      busy = false;
      sendError(err.message);
      return;
    }
    var pending = 2;
    var results = {};
    function done(key) {
      return function (e, data) {
        results[key] = { err: e, data: data };
        if (--pending > 0) return;
        busy = false;
        if (results.status.err && results.battery.err) {
          sendError(results.battery.err.message);
          return;
        }
        send(buildPayload(vehicle, results.status.data, results.battery.data));
      };
    }
    var vinPath = '/v1/vehicles/' + encodeURIComponent(vehicle.vin);
    authGet(cfg, vinPath + '/status', done('status'));
    authGet(cfg, vinPath + '/batteries', done('battery'));
  });
}

// ---------------------------------------------------------------------------
// Events

Pebble.addEventListener('ready', function () {
  console.log('CarGlance pkjs ready');
  refresh();
});

Pebble.addEventListener('appmessage', function (e) {
  if (e.payload && e.payload.REFRESH !== undefined) {
    refresh();
  }
});

// In the emulator Clay routes the page through an http-only S3 proxy that
// fills in the return URL; browsers that force HTTPS can't load it. Serve the
// page as a data URI instead and let it read return_to (which pebble-tool
// appends) from its own location.
var CLAY_EMU_PROXY = 'http://clay.pebble.com.s3-website-us-west-2.amazonaws.com/#';

function configUrl() {
  var url = clay.generateUrl();
  if (url.indexOf(CLAY_EMU_PROXY) !== 0) return url;
  var html = decodeURIComponent(url.slice(CLAY_EMU_PROXY.length)).replace(
    '"$$RETURN_TO$$"',
    '(new URLSearchParams(location.search).get("return_to")||"pebblejs://close#")');
  return 'data:text/html;charset=utf-8,' + encodeURIComponent(html);
}

Pebble.addEventListener('showConfiguration', function () {
  Pebble.openURL(configUrl());
});

Pebble.addEventListener('webviewclosed', function (e) {
  if (!e || !e.response) return;
  var settings = clay.getSettings(e.response, false);
  var cfg = {};
  Object.keys(settings).forEach(function (key) {
    cfg[key] = settings[key] && settings[key].value;
  });
  saveJSON(STORE_CONFIG, cfg);
  saveJSON(STORE_TOKEN, null);
  saveJSON(STORE_VEHICLE, null);
  send({ STATUS: 'loading' });
  refresh();
});

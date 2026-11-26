// Phone-side companion: owns the credentials, talks to the Pleos Vehicle Data
// API and pushes a compact summary to the watch.
var Clay = require('@rebble/clay');
var clayConfig = require('./config');

var clay = new Clay(clayConfig, null, { autoHandleEvents: false });

var API_BASE = 'https://api.pleos.ai';
// The Internet permission for API_BASE, as declared in package.json's
// usesPermissions. It is optional: the phone app asks for it the first time a
// request is made, so the demo never needs it. Until the user answers, or if
// they turned it off, requests fail like a network error.
var INTERNET_PERMISSION = 'Internet/api.pleos.ai';
// What the watch shows when a request failed because of the permission, by
// Pebble.permissions.query state (at most 60 characters, see sendError).
var PERMISSION_ERRORS = {
  prompt: 'Allow CarGlance internet access in the Pebble app',
  denied: 'Internet access for CarGlance is off in the Pebble app'
};
var STORE_CONFIG = 'bp-config';
var STORE_TOKEN = 'bp-token';
var STORE_VEHICLES = 'bp-vehicles';
var STORE_SELECTED = 'bp-selected';
// Replaced by STORE_VEHICLES; removed on startup.
var STORE_LEGACY_VEHICLE = 'bp-vehicle';

// Upper bounds for the vehicle list sent to the watch. The watch's inbox is
// 1.5 kB (input in src/embeddedjs/car.js), and a message also carries the
// status fields and the warnings (MAX_WARNINGS_BYTES), so the list gets at
// most VEHICLES_MAX_BYTES of it
// (UTF-8): 20 ASCII names fit, fewer with multibyte names. Cars past the limit
// are left out of the picker.
var MAX_VEHICLES = 20;
var VEHICLE_NAME_MAX = 24;
var VEHICLES_MAX_BYTES = 600;
// Longest car name sent for the watch's header (which shortens it to fit).
var NAME_MAX = 40;

// Responses that mean "get a new token and try again", by HTTP status and by
// the API's own `error.code`. 40002-40004 were handled from the start. The API
// codes 401, 403 and 4011 were added for issue #8 as likely token rejections;
// no failing response was captured to confirm them.
var TOKEN_HTTP_STATUSES = [401, 403];
var TOKEN_ERRORS = [401, 403, 4011, 40002, 40003, 40004];
var TOKEN_EXPIRY_MARGIN_MS = 60000;
var tokenRequest = null;
var configGeneration = 0;

// VIN whose data is currently being fetched, so that repeated refreshes for
// the same car don't pile up and results for a car that is no longer selected
// are dropped.
var inflightVin = null;

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
    clientSecret: (cfg.clientSecret || '').trim()
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
    (TOKEN_HTTP_STATUSES.indexOf(err.httpStatus) !== -1 ||
      TOKEN_ERRORS.indexOf(Number(err.code)) !== -1);
}

// Read only the JWT expiry claim. This is a cache freshness check, not signature
// verification; the API remains responsible for authenticating the token.
// Decode base64url using ES5 primitives.
function tokenExpiresAt(token) {
  try {
    var parts = typeof token === 'string' ? token.split('.') : [];
    if (parts.length !== 3) return 0;
    var encoded = parts[1];
    if (!encoded || /[^A-Za-z0-9_-]/.test(encoded) || encoded.length % 4 === 1) return 0;
    var alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    var bits = 0;
    var buffer = 0;
    var decoded = '';
    for (var i = 0; i < encoded.length; i++) {
      buffer = (buffer << 6) | alphabet.indexOf(encoded.charAt(i));
      bits += 6;
      if (bits >= 8) {
        bits -= 8;
        decoded += String.fromCharCode((buffer >> bits) & 255);
      }
    }
    var exp = JSON.parse(decoded).exp;
    return typeof exp === 'number' && isFinite(exp) && exp > 0 ? exp * 1000 : 0;
  } catch (e) {
    return 0;
  }
}

function isTokenValid(token) {
  return tokenExpiresAt(token) > Date.now() + TOKEN_EXPIRY_MARGIN_MS;
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
    networkError('Network error', cb);
  };
  xhr.ontimeout = function () {
    networkError('Request timed out', cb);
  };
  xhr.send(body ? JSON.stringify(body) : null);
}

// Reports a request that got no response. If that is because the user hasn't
// allowed the Internet permission (yet), says so instead of `message`. Phone
// apps without the permission system have no Pebble.permissions.
function networkError(message, cb) {
  var answered = false;
  function answer(state) {
    if (answered) return;
    answered = true;
    cb(new ApiError(PERMISSION_ERRORS[state] || message));
  }
  var permissions = typeof Pebble !== 'undefined' && Pebble.permissions;
  if (!permissions || typeof permissions.query !== 'function') {
    answer(null);
    return;
  }
  try {
    permissions.query(INTERNET_PERMISSION).then(answer, function () { answer(null); });
  } catch (e) {
    answer(null);
  }
}

function fetchToken(cfg, cb) {
  // Status and battery requests share one renewal, including when both reject
  // the old token at the same time.
  if (tokenRequest && tokenRequest.generation === configGeneration) {
    tokenRequest.callbacks.push(cb);
    return;
  }
  var flight = { generation: configGeneration, callbacks: [cb] };
  tokenRequest = flight;
  function finish(err, token) {
    if (tokenRequest === flight) tokenRequest = null;
    flight.callbacks.forEach(function (callback) { callback(err, token); });
  }
  request('POST', '/v1/auth/personal-token', cfg, null,
    { clientId: cfg.clientId, clientSecret: cfg.clientSecret },
    function (err, data) {
      // Settings changed meanwhile: drop the response without notifying the
      // waiters. webviewclosed already started a refresh for the new settings.
      if (flight.generation !== configGeneration) {
        if (tokenRequest === flight) tokenRequest = null;
        return;
      }
      if (err) {
        if (err.httpStatus >= 400 && err.httpStatus < 500) {
          err.message = 'Login failed. Check Client ID, Secret and manufacturer.';
        }
        finish(err);
        return;
      }
      if (!data || !data.accessToken) {
        finish(new ApiError('No access token'));
        return;
      }
      saveJSON(STORE_TOKEN, data.accessToken);
      finish(null, data.accessToken);
    });
}

// Calls cb(err, token, cached), where cached tells whether the token was
// reused from storage rather than issued by a renewal for this call.
function getToken(cfg, rejectedToken, cb) {
  var cached = loadJSON(STORE_TOKEN);
  // A delayed failure must not delete a newer token another request obtained.
  if (cached && cached !== rejectedToken && isTokenValid(cached)) {
    cb(null, cached, true);
    return;
  }
  saveJSON(STORE_TOKEN, null);
  fetchToken(cfg, function (err, token) {
    cb(err, token, false);
  });
}

// Refresh before sending an expired token. Still retry once if the server
// rejects an unexpired cached token (revocation, clock skew). A token that was
// just issued can't be stale, so its rejection is a real access denial and is
// reported without another login.
// Responses that arrive after a settings change are dropped without calling
// cb: the refresh started by webviewclosed reports for the new settings, and
// a stale result must not overwrite it or clear its inflightVin.
function authGet(cfg, path, cb) {
  var generation = configGeneration;
  function withToken(token, retry) {
    request('GET', path, cfg, token, null, function (err, data) {
      if (generation !== configGeneration) return;
      if (err && retry && isTokenError(err)) {
        getToken(cfg, token, function (tokErr, fresh) {
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
  getToken(cfg, null, function (err, token, cached) {
    if (err) {
      cb(err);
    } else {
      withToken(token, cached);
    }
  });
}

// ---------------------------------------------------------------------------
// Data mapping

var DEMO_VEHICLES = [
  { vin: 'DEMO0000000001234', name: 'IONIQ 5 (demo)' },
  { vin: 'DEMO0000000005678', name: 'KONA Electric (demo)' },
  { vin: 'DEMO0000000009012', name: 'IONIQ 6 (demo)' }
];

// Returns the cached vehicle list, fetching it once per set of credentials.
function loadVehicles(cfg, cb) {
  var cached = loadJSON(STORE_VEHICLES);
  if (cached && cached.length) {
    cb(null, cached);
    return;
  }
  authGet(cfg, '/v1/vehicles/consent', function (err, data) {
    if (err) {
      cb(err);
      return;
    }
    var vehicles = (data.vehicles || []).filter(function (v) {
      return v && v.vin;
    }).map(function (v) {
      return { vin: v.vin, name: v.nickname || v.sellname || v.name || v.vin };
    });
    if (!vehicles.length) {
      cb(new ApiError('No vehicles'));
      return;
    }
    saveJSON(STORE_VEHICLES, vehicles);
    cb(null, vehicles);
  });
}

// Index of the selected vehicle; falls back to the first one when nothing is
// selected yet or the selected car is no longer on the account.
function selectedIndex(vehicles) {
  var vin = loadJSON(STORE_SELECTED);
  for (var i = 0; i < vehicles.length; i++) {
    if (vehicles[i].vin === vin) return i;
  }
  return 0;
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

// Length of a string in UTF-8 bytes, as AppMessage sends it.
function utf8Length(str) {
  var bytes = 0;
  for (var i = 0; i < str.length; i++) {
    var c = str.charCodeAt(i);
    if (c < 0x80) bytes += 1;
    else if (c < 0x800) bytes += 2;
    else if (c >= 0xD800 && c < 0xDC00 && i + 1 < str.length) { bytes += 4; i++; }
    else bytes += 3;
  }
  return bytes;
}

// Vehicle list for the car picker: one "name<TAB>last 4 VIN digits" entry
// per line, within MAX_VEHICLES entries and VEHICLES_MAX_BYTES.
function vehicleFields(vehicles, index) {
  var list = '';
  var bytes = 0;
  for (var i = 0; i < vehicles.length && i < MAX_VEHICLES; i++) {
    var name = String(vehicles[i].name).replace(/[\t\n]/g, ' ').substring(0, VEHICLE_NAME_MAX);
    var line = (i ? '\n' : '') + name + '\t' + vehicles[i].vin.slice(-4);
    var size = utf8Length(line);
    if (bytes + size > VEHICLES_MAX_BYTES) break;
    list += line;
    bytes += size;
  }
  return { VEHICLES: list, VEHICLE_INDEX: index };
}

function isNumber(v) {
  return typeof v === 'number' && isFinite(v);
}

// 48213 -> "48,213"
function formatNumber(n) {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

// What else is open next to the doors, for the doors label: "trunk open",
// "hood, trunk open", "all closed" or '' when unknown.
function openingsNote(status, locked) {
  if (!status) return '';
  var open = ['hood', 'trunk', 'sunroof'].filter(function (part) {
    return status[part] === 'open';
  });
  if (open.length) return open.join(', ') + ' open';
  return locked === 0 || locked === 1 ? 'all closed' : '';
}

// The charge limit that applies: DC while fast charging, AC otherwise.
function targetSoc(charge) {
  var target = charge.targetStateOfCharge || {};
  var value = charge.status === 'fastCharging' ? target.quick : target.standard;
  return isNumber(value) && value > 0 && value <= 100 ? Math.round(value) : -1;
}

var DISTANCE_UNITS = { km: 'km', miles: 'mi', mile: 'mi' };

// Range from /powertrains: the EV value if there is one, else the first valid.
function rangeText(powertrain) {
  var list = (powertrain && powertrain.distanceToEmpties) || [];
  var pick = null;
  list.forEach(function (d) {
    if (d && DISTANCE_UNITS[d.unit] && isFinite(parseFloat(d.value)) && (!pick || d.type === 'EV')) {
      pick = d;
    }
  });
  return pick ? formatNumber(parseFloat(pick.value)) + ' ' + DISTANCE_UNITS[pick.unit] : '';
}

// Odometer from /driving, in km or miles.
function odometerText(driving) {
  var odo = driving && driving.odometer;
  if (!odo || !isNumber(odo.value)) return '';
  if (DISTANCE_UNITS[odo.unit]) return formatNumber(odo.value) + ' ' + DISTANCE_UNITS[odo.unit];
  if (odo.unit === 'meter') return formatNumber(odo.value / 1000) + ' km';
  if (odo.unit === 'feet') return formatNumber(odo.value / 5280) + ' mi';
  return '';
}

// 21.5 -> "21.5°", to the half degree.
function degrees(t) {
  return String(Math.round(t.value * 2) / 2) + '°';
}

function temperatureText(t) {
  if (!t || !isNumber(t.value) || (t.unit !== 'C' && t.unit !== 'F')) return '';
  return Math.round(t.value) + '°' + t.unit;
}

// Climate for the facts strip: "21.5° auto", "On" or "Off"; on is 1, 0 or -1.
function climate(status) {
  var cc = status && status.climateControl;
  if (!cc || cc.mode === 'error' || (cc.status !== 'on' && cc.status !== 'off')) {
    return { text: '', on: -1 };
  }
  if (cc.status === 'off') return { text: 'Off', on: 0 };
  var t = cc.temperature;
  var text = t && isNumber(t.value) ? degrees(t) : 'On';
  return { text: cc.mode === 'auto' ? text + ' auto' : text, on: 1 };
}

// Tire pressure as the API encodes it: psi as is, kPa in steps of 5, bar in
// tenths; 255 means invalid.
function tirePressure(status, row, side) {
  var tire = status.tire && status.tire[row];
  var v = tire && tire[side];
  if (!isNumber(v) || v < 0 || v > 254) return '';
  if (tire.unit === 'psi') return v + ' psi';
  if (tire.unit === 'kpa') return v * 5 + ' kPa';
  if (tire.unit === 'bar') return (v / 10).toFixed(1) + ' bar';
  return '';
}

var TIRES = {
  tirePressureFrontLeft: ['front left', 0, 'left'],
  tirePressureFrontRight: ['front right', 0, 'right'],
  tirePressureRearLeft: ['rear left', 1, 'left'],
  tirePressureRearRight: ['rear right', 1, 'right']
};

// Title and detail of each warning token of /status.
var WARNINGS = {
  lowFuel: ['Fuel low', 'Refuel soon'],
  smartKeyBattery: ['Key battery low', 'Replace the key battery'],
  washFluid: ['Washer fluid low', 'Top up soon'],
  brakeOil: ['Brake fluid low', 'Have it checked'],
  engineOil: ['Engine oil low', 'Have it checked'],
  tirePressureLow: ['Tire pressure low', 'Check all tires'],
  frontHeadLamp: ['Bulb failure', 'Headlamp'],
  frontLeftTurnSignal: ['Bulb failure', 'Front left turn signal'],
  frontRightTurnSignal: ['Bulb failure', 'Front right turn signal'],
  rearLeftStopLamp: ['Bulb failure', 'Rear left brake light'],
  rearRightStopLamp: ['Bulb failure', 'Rear right brake light'],
  rearLeftTurnSignal: ['Bulb failure', 'Rear left turn signal'],
  rearRightTurnSignal: ['Bulb failure', 'Rear right turn signal']
};

// Longest WARNINGS text sent in UTF-8 bytes, so that it fits the watch's
// 1.5 kB inbox next to the car list. Warnings beyond it are left out.
var MAX_WARNINGS_BYTES = 400;

// The car's warnings for the watch: one "title<TAB>detail" entry per line.
function warningsText(status) {
  var lines = [];
  var length = 0;
  ((status && status.warnings) || []).forEach(function (token) {
    var tire = TIRES[token];
    var entry;
    if (tire) {
      entry = ['Low tire: ' + tire[0], tirePressure(status, tire[1], tire[2]) || 'Check the pressure'];
    } else {
      entry = WARNINGS[token] || ['Car warning', String(token).substring(0, 30)];
    }
    var line = entry.join('\t');
    var size = utf8Length(line) + (lines.length ? 1 : 0);
    if (length + size > MAX_WARNINGS_BYTES) return;
    lines.push(line);
    length += size;
  });
  return lines.join('\n');
}

// status and battery decide whether the refresh worked; powertrain (range)
// and driving (odometer) are extras that may be missing.
function buildPayload(vehicle, status, battery, powertrain, driving) {
  var charge = (battery && battery.charge) || {};
  var soc = typeof charge.stateOfCharge === 'number' ? Math.round(charge.stateOfCharge) : -1;
  var locked = status ? lockState(status) : -1;
  var cc = climate(status);
  return {
    STATUS: 'ok',
    NAME: String(vehicle.name).substring(0, NAME_MAX),
    LOCKED: locked,
    DOORS_NOTE: openingsNote(status, locked),
    PLUGGED: charge.plugin === 'connected' ? 1 : (charge.plugin === 'disconnected' ? 0 : -1),
    CHARGING: charge.charging ? 1 : 0,
    CHARGE_STATUS: charge.status || '',
    SOC: soc,
    TARGET_SOC: targetSoc(charge),
    REMAIN_MIN: typeof charge.remainTime === 'number' ? charge.remainTime : 0,
    RANGE: rangeText(powertrain),
    TEMP: temperatureText(status && status.outsideTemperature),
    CLIMATE: cc.text,
    CLIMATE_ON: cc.on,
    ODOMETER: odometerText(driving),
    WARNINGS: warningsText(status),
    DATA_TIME: dataTime(battery && battery.timestamp, status && status.timestamp)
  };
}

function demoPayload(index) {
  // Sample data ages: fresh-ish for the first car, stale for the second.
  function ago(min) { return new Date(Date.now() - min * 60 * 1000).toISOString(); }
  function km(range, odometer) {
    return [
      { distanceToEmpties: [{ type: 'EV', value: String(range), unit: 'km' }] },
      { odometer: { value: odometer, unit: 'km' } }
    ];
  }
  var locked = [{ left: 'locked', right: 'locked' }, { left: 'locked', right: 'locked' }];
  var extras;
  if (index === 1) {
    // Unlocked, trunk open, low battery and one warning.
    extras = km(71, 52904);
    return buildPayload(DEMO_VEHICLES[1], {
      doors: [{ left: 'closed', right: 'locked' }, { left: 'locked', right: 'locked' }],
      trunk: 'open',
      tire: [{ left: 25, right: 25, unit: 'bar' }, { left: 19, right: 24, unit: 'bar' }],
      warnings: ['tirePressureRearLeft'],
      outsideTemperature: { value: 3, unit: 'C' },
      climateControl: { mode: 'off', status: 'off' }
    }, {
      charge: { plugin: 'disconnected', charging: false, stateOfCharge: 18 }, timestamp: ago(180)
    }, extras[0], extras[1]);
  }
  if (index === 2) {
    // Plugged in at the charge limit, several warnings.
    extras = km(226, 48377);
    return buildPayload(DEMO_VEHICLES[2], {
      doors: locked, trunk: 'closed', hood: 'closed',
      warnings: ['washFluid', 'smartKeyBattery', 'rearLeftTurnSignal'],
      outsideTemperature: { value: 12, unit: 'C' },
      climateControl: { mode: 'off', status: 'off' }
    }, {
      charge: { plugin: 'connected', status: 'notCharging', charging: false, stateOfCharge: 54, targetStateOfCharge: { standard: 80, quick: 90 } },
      timestamp: ago(12)
    }, extras[0], extras[1]);
  }
  extras = km(312, 48213);
  return buildPayload(DEMO_VEHICLES[0], {
    doors: locked, trunk: 'closed', hood: 'closed', sunroof: 'closed',
    outsideTemperature: { value: 8.2, unit: 'C' },
    climateControl: { mode: 'auto', status: 'on', temperature: { value: 21, unit: 'C' } }
  }, {
    charge: {
      plugin: 'connected', status: 'charging', charging: true, stateOfCharge: 73.4, remainTime: 95,
      targetStateOfCharge: { standard: 80, quick: 90 }
    },
    timestamp: ago(7)
  }, extras[0], extras[1]);
}

function merge(a, b) {
  Object.keys(b).forEach(function (k) { a[k] = b[k]; });
  return a;
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

function sendError(msg, extra) {
  send(merge({ STATUS: 'error', ERROR: String(msg).substring(0, 60) }, extra || {}));
}

// Endpoints for extras (range, odometer) the API refused with 403 or 404 for
// the current settings. A refused extra would otherwise renew the token on
// every refresh (403 counts as a rejected token) and fail again.
var refusedExtras = {};
var refusedGeneration = 0;

function extraGet(cfg, path, cb) {
  if (refusedGeneration !== configGeneration) {
    refusedExtras = {};
    refusedGeneration = configGeneration;
  }
  if (refusedExtras[path]) {
    cb(new ApiError('Not available'));
    return;
  }
  var generation = configGeneration;
  authGet(cfg, path, function (err, data) {
    if (err && generation === configGeneration && (err.httpStatus === 403 || err.httpStatus === 404)) {
      refusedExtras[path] = true;
    }
    cb(err, data);
  });
}

function isDemo(cfg) {
  return cfg.clientId.toLowerCase() === 'demo';
}

function refresh() {
  var cfg = getConfig();
  if (isDemo(cfg)) {
    var demoIndex = selectedIndex(DEMO_VEHICLES);
    send(merge(demoPayload(demoIndex), vehicleFields(DEMO_VEHICLES, demoIndex)));
    return;
  }
  if (!cfg.clientId || !cfg.clientSecret) {
    send({ STATUS: 'nocreds' });
    return;
  }

  loadVehicles(cfg, function (err, vehicles) {
    if (err) {
      sendError(err.message);
      return;
    }
    var index = selectedIndex(vehicles);
    var vehicle = vehicles[index];
    if (inflightVin === vehicle.vin) return;
    inflightVin = vehicle.vin;

    var pending = 4;
    var results = {};
    function done(key) {
      return function (e, data) {
        results[key] = { err: e, data: data };
        if (--pending > 0) return;
        // Another car was selected meanwhile; its own refresh reports.
        if (inflightVin !== vehicle.vin) return;
        inflightVin = null;
        var fields = vehicleFields(vehicles, index);
        if (results.status.err && results.battery.err) {
          sendError(results.battery.err.message, fields);
          return;
        }
        send(merge(buildPayload(vehicle, results.status.data, results.battery.data,
          results.powertrain.data, results.driving.data), fields));
      };
    }
    var vinPath = '/v1/vehicles/' + encodeURIComponent(vehicle.vin);
    authGet(cfg, vinPath + '/status', done('status'));
    authGet(cfg, vinPath + '/batteries', done('battery'));
    extraGet(cfg, vinPath + '/powertrains', done('powertrain'));
    extraGet(cfg, vinPath + '/driving', done('driving'));
  });
}

// The watch reports the picked car by its position in the list it was sent.
function selectVehicle(index) {
  var cfg = getConfig();
  var vehicles = isDemo(cfg) ? DEMO_VEHICLES : loadJSON(STORE_VEHICLES);
  if (vehicles && vehicles[index]) {
    saveJSON(STORE_SELECTED, vehicles[index].vin);
  }
  refresh();
}

// Earlier versions picked the car with a VIN field in the settings. Keep that
// car selected and drop the old vehicle cache.
function migrateLegacyVin() {
  saveJSON(STORE_LEGACY_VEHICLE, null);
  var cfg = loadJSON(STORE_CONFIG);
  if (!cfg || cfg.vin === undefined) return;
  var vin = String(cfg.vin || '').trim().toUpperCase();
  if (vin && !loadJSON(STORE_SELECTED)) {
    saveJSON(STORE_SELECTED, vin);
  }
  delete cfg.vin;
  saveJSON(STORE_CONFIG, cfg);
}

// ---------------------------------------------------------------------------
// Events

Pebble.addEventListener('ready', function () {
  console.log('CarGlance pkjs ready');
  migrateLegacyVin();
  refresh();
});

Pebble.addEventListener('appmessage', function (e) {
  if (!e.payload) return;
  if (e.payload.SELECT_VEHICLE !== undefined) {
    selectVehicle(Number(e.payload.SELECT_VEHICLE));
  } else if (e.payload.REFRESH !== undefined) {
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
  configGeneration++;
  saveJSON(STORE_TOKEN, null);
  saveJSON(STORE_VEHICLES, null);
  inflightVin = null;
  send({ STATUS: 'loading' });
  refresh();
});

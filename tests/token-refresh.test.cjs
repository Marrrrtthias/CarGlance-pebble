// No real credentials or network calls. Run: node --test tests/token-refresh.test.cjs
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../src/pkjs/index.js'), 'utf8');
const now = 1800000000000;
const cfg = { brand: 'kia', clientId: 'test-id', clientSecret: 'test-secret' };
const jwt = exp => 'header.' + Buffer.from(JSON.stringify({ exp })).toString('base64url') + '.signature';
const valid = jwt(now / 1000 + 3600);
const fresh = jwt(now / 1000 + 7200);

function runtime(storage = new Map(), time = now) {
  const requests = [];
  const events = {};
  function Clay() { this.getSettings = response => JSON.parse(response); }
  const context = vm.createContext({
    require: () => Clay,
    console: { log() {} },
    localStorage: {
      getItem: key => storage.get(key) || null,
      setItem: (key, value) => storage.set(key, value),
      removeItem: key => storage.delete(key)
    },
    Pebble: {
      addEventListener: (name, callback) => { events[name] = callback; },
      sendAppMessage: (payload, success) => success()
    }
  });
  vm.runInContext(source, context);
  context.clock = time;
  vm.runInContext('Date.now = function () { return clock; };', context);
  context.request = (method, endpoint, config, token, body, callback) => {
    requests.push({ method, endpoint, token, callback });
  };
  return { context, storage, requests, events };
}

function stored(token) {
  return new Map([['bp-token', JSON.stringify(token)]]);
}

function take(app, method) {
  const request = app.requests.shift();
  assert.ok(request, 'expected an HTTP request');
  assert.equal(request.method, method);
  return request;
}

test('valid cached token is reused without authentication', () => {
  const app = runtime(stored(valid));
  let result;
  app.context.authGet(cfg, '/status', (error, data) => { assert.ifError(error); result = data; });
  const get = take(app, 'GET');
  assert.equal(get.token, valid);
  get.callback(null, { ok: true });
  assert.equal(result.ok, true);
  assert.equal(app.requests.length, 0);
});

test('reopening after more than one hour renews before any vehicle GET', () => {
  const storage = stored(valid);
  runtime(storage); // first JavaScript lifetime
  const reopened = runtime(storage, now + 3601000);
  let completed = false;
  reopened.context.authGet(cfg, '/status', error => { assert.ifError(error); completed = true; });
  take(reopened, 'POST').callback(null, { accessToken: fresh });
  const get = take(reopened, 'GET');
  assert.equal(get.token, fresh);
  get.callback(null, {});
  assert.ok(completed);
});

test('missing, malformed, missing-expiry and near-expiry caches are renewed', () => {
  for (const token of [null, 'invalid', 'a.!!!!.b', 'a.e30.b', jwt('not-a-number'), jwt(now / 1000 + 60)]) {
    const app = runtime(stored(token));
    app.context.authGet(cfg, '/status', () => {});
    assert.equal(take(app, 'POST').endpoint, '/v1/auth/personal-token');
    assert.equal(app.requests.length, 0);
  }
});

test('parallel requests share a single renewal', () => {
  const app = runtime(stored(jwt(now / 1000 - 1)));
  app.context.authGet(cfg, '/status', () => {});
  app.context.authGet(cfg, '/batteries', () => {});
  const post = take(app, 'POST');
  assert.equal(app.requests.length, 0);
  post.callback(null, { accessToken: fresh });
  assert.equal(take(app, 'GET').token, fresh);
  assert.equal(take(app, 'GET').token, fresh);
  assert.equal(app.requests.length, 0);
});

test('invalid-token and Forbidden responses renew once, then surface persistent rejection', () => {
  for (const [http, code] of [[400, 40003], [400, 4011], [401, null], [403, null], [400, 403]]) {
    const app = runtime(stored(valid));
    let result;
    app.context.authGet(cfg, '/status', error => { result = error; });
    take(app, 'GET').callback(new app.context.ApiError('Forbidden', code, http));
    take(app, 'POST').callback(null, { accessToken: fresh });
    const retry = take(app, 'GET');
    assert.equal(retry.token, fresh);
    retry.callback(new app.context.ApiError('Forbidden', code, http));
    assert.equal(result.message, 'Forbidden');
    assert.equal(app.requests.length, 0);
  }
});

test('simultaneous rejections share renewal and delayed rejections reuse its result', () => {
  for (const delayed of [false, true]) {
    const app = runtime(stored(valid));
    app.context.authGet(cfg, '/status', () => {});
    app.context.authGet(cfg, '/batteries', () => {});
    const first = take(app, 'GET');
    const second = take(app, 'GET');
    const reject = request => request.callback(new app.context.ApiError('Forbidden', 403, 400));
    reject(first);
    const post = take(app, 'POST');
    if (!delayed) reject(second);
    post.callback(null, { accessToken: fresh });
    if (delayed) reject(second);
    assert.equal(take(app, 'GET').token, fresh);
    assert.equal(take(app, 'GET').token, fresh);
    assert.equal(app.requests.length, 0);
  }
});

test('failed renewal notifies all waiting requests and allows a later attempt', () => {
  const app = runtime();
  let failures = 0;
  const callback = error => { assert.ok(error); failures++; };
  app.context.authGet(cfg, '/status', callback);
  app.context.authGet(cfg, '/batteries', callback);
  take(app, 'POST').callback(new app.context.ApiError('Network error'));
  assert.equal(failures, 2);
  app.context.authGet(cfg, '/status', () => {});
  take(app, 'POST');
});

test('bad token responses are not persisted or sent to vehicle endpoints', () => {
  for (const token of [undefined, 'invalid', jwt(now / 1000 - 1)]) {
    const app = runtime();
    let result;
    app.context.authGet(cfg, '/status', error => { result = error; });
    take(app, 'POST').callback(null, { accessToken: token });
    assert.ok(result);
    assert.equal(app.storage.has('bp-token'), false);
    assert.equal(app.requests.length, 0);
  }
});

test('server and transport errors do not trigger token renewal', () => {
  for (const status of [undefined, 429, 500, 503]) {
    const app = runtime(stored(valid));
    let result;
    app.context.authGet(cfg, '/status', error => { result = error; });
    take(app, 'GET').callback(new app.context.ApiError('Request failed', null, status));
    assert.ok(result);
    assert.equal(app.requests.length, 0);
  }
});

test('a settings change prevents an older authentication response from overwriting the new token', () => {
  const app = runtime();
  let oldError;
  app.context.authGet(cfg, '/status', error => { oldError = error; });
  const oldPost = take(app, 'POST');
  app.events.webviewclosed({ response: JSON.stringify({ clientId: { value: 'demo' } }) });
  app.storage.set('bp-token', JSON.stringify(fresh));
  oldPost.callback(null, { accessToken: valid });
  assert.equal(JSON.parse(app.storage.get('bp-token')), fresh);
  assert.ok(oldError);
});

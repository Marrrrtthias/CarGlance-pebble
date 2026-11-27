// The Internet permission: a request without a response reports a
// missing permission instead of a network error. Run: node --test tests/permission.test.cjs
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../src/pkjs/index.js'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json'), 'utf8')).pebble;

function runtime(permissions) {
  const queried = [];
  const pebble = { addEventListener() {}, sendAppMessage() {} };
  if (permissions) {
    pebble.permissions = {
      query: name => { queried.push(name); return permissions(name); }
    };
  }
  const context = vm.createContext({
    require: () => function Clay() {},
    console: { log() {} },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    Pebble: pebble
  });
  vm.runInContext(source, context);
  return { context, queried };
}

function failure(app, message) {
  return new Promise(resolve => app.context.networkError(message, resolve));
}

test('the queried permission is the one package.json declares, as required', () => {
  const app = runtime();
  const [name, domain] = app.context.INTERNET_PERMISSION.split('/');
  const declared = manifest.usesPermissions.filter(p => p.name === name);
  assert.equal(declared.length, 1);
  assert.deepEqual(declared[0].parameters.domains, [domain]);
  assert.equal('https://' + domain, app.context.API_BASE);
  assert.equal(declared[0].required, true);
  assert.ok(declared[0].reason);
});

test('a pending or denied permission replaces the network error', async () => {
  for (const state of ['prompt', 'denied']) {
    const app = runtime(() => Promise.resolve(state));
    const error = await failure(app, 'Network error');
    assert.equal(error.message, app.context.PERMISSION_ERRORS[state]);
    assert.ok(error.message.length <= 60);
    assert.deepEqual(app.queried, ['Internet/api.pleos.ai']);
  }
});

test('a granted permission, a failed query or no permission system keep the network error', async () => {
  const cases = [
    () => Promise.resolve('granted'),
    () => Promise.reject(new Error('unknown permission')),
    () => { throw new Error('not supported'); },
    null
  ];
  for (const permissions of cases) {
    const error = await failure(runtime(permissions), 'Request timed out');
    assert.equal(error.message, 'Request timed out');
  }
});

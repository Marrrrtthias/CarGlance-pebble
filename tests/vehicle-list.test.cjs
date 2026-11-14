// The car list sent to the watch must fit its 1 kB AppMessage inbox
// (input in src/embeddedjs/car.js). Run: node --test tests/vehicle-list.test.cjs
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../src/pkjs/index.js'), 'utf8');

function load() {
  const context = vm.createContext({
    require: () => function Clay() {},
    console: { log() {} },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    Pebble: { addEventListener() {}, sendAppMessage() {} }
  });
  vm.runInContext(source, context);
  return context;
}

function cars(count, name) {
  return Array.from({ length: count }, (_, i) => ({
    name: name(i), vin: 'VIN' + String(i).padStart(14, '0')
  }));
}

test('utf8Length counts bytes as UTF-8 encodes them', () => {
  const app = load();
  for (const str of ['', 'IONIQ 5', 'Größe', '€ 5', 'car 🚗', 'é€🚗'])
    assert.equal(app.utf8Length(str), Buffer.byteLength(str, 'utf8'), str);
});

test('a short list is sent whole, names and last VIN digits', () => {
  const app = load();
  const fields = app.vehicleFields([
    { name: 'IONIQ 5', vin: 'DEMO0000000001234' },
    { name: 'KONA\tElectric\n', vin: 'DEMO0000000005678' }
  ], 1);
  assert.equal(fields.VEHICLES, 'IONIQ 5\t1234\nKONA Electric \t5678');
  assert.equal(fields.VEHICLE_INDEX, 1);
});

test('long ASCII names are shortened and 20 cars still fit', () => {
  const app = load();
  const fields = app.vehicleFields(cars(30, i => 'A very long car name number ' + i), 0);
  const lines = fields.VEHICLES.split('\n');
  assert.equal(lines.length, 20);
  for (const line of lines) assert.ok(line.split('\t')[0].length <= 24, line);
  assert.ok(Buffer.byteLength(fields.VEHICLES, 'utf8') <= 600);
});

test('multibyte names stay within the byte budget and keep whole entries', () => {
  const app = load();
  const fields = app.vehicleFields(cars(20, () => '🚗'.repeat(12)), 0);
  assert.ok(Buffer.byteLength(fields.VEHICLES, 'utf8') <= 600);
  const lines = fields.VEHICLES.split('\n');
  assert.ok(lines.length > 0 && lines.length < 20);
  for (const line of lines) assert.match(line, /\t\d{4}$/);
});

test('the largest message fits the watch inbox', () => {
  const app = load();
  // An "ok" payload with the longest name and list, sized as a Pebble
  // dictionary: 1 byte count, 7 bytes per tuple header, strings with a NUL.
  const payload = Object.assign(
    app.buildPayload({ name: '€'.repeat(100) }, null, { charge: { status: 'fastCharging' } }),
    app.vehicleFields(cars(20, () => '€'.repeat(30)), 0));
  let size = 1;
  for (const key of Object.keys(payload)) {
    const value = payload[key];
    size += 7 + (typeof value === 'string' ? Buffer.byteLength(value, 'utf8') + 1 : 4);
  }
  assert.ok(size <= 1024, 'message is ' + size + ' bytes');
});

// The car's state as the phone reports it, and the requests the watch sends
// back. All network access happens on the phone (src/pkjs/index.js); the watch
// only shows what it receives and asks for refreshes.
//
// Windows read `car` when they are built and get onCarChanged whenever it
// changes.
import Message from "pebble/message";
import WindowStack from "pebble-ui/WindowStack";

const AUTO_REFRESH_MS = 10 * 60 * 1000;
// How long a failed refresh's error replaces the data's age in the footer.
const ERROR_SHOW_MS = 5 * 1000;

export const car = {
	// "loading" | "ok" | "nocreds" | "error"
	state: { status: "loading" },
	refreshing: true,
	// Cars on the account ({ name, last4 }) and the index of the shown one.
	vehicles: [],
	vehicleIndex: 0,
};

function changed() {
	WindowStack.current?.container?.distribute("onCarChanged");
}

// Closes the car picker (and anything else above the dashboard).
function closeWindows() {
	const stack = WindowStack.current;
	if (stack?.depth)
		stack.pop(stack.depth);
}

// ---------------------------------------------------------------------------
// Requests

let writable = false;
let refreshPending = true; // request data as soon as the channel is ready
let selectPending = -1;    // car picked while the channel was not ready

function flushRequests() {
	if (!writable || (!refreshPending && selectPending < 0)) return;
	// Selecting a car also refreshes it on the phone.
	const msg = selectPending >= 0
		? new Map([["SELECT_VEHICLE", selectPending]])
		: new Map([["REFRESH", 1]]);
	try {
		message.write(msg);
		refreshPending = false;
		selectPending = -1;
	} catch (e) {
		console.log("request write failed: " + e);
	}
}

export function requestRefresh() {
	car.refreshing = true;
	changed();
	refreshPending = true;
	flushRequests();
}

export function pickVehicle(i) {
	if (i !== car.vehicleIndex) {
		car.vehicleIndex = i;
		// Show the new car's name right away; its data follows.
		car.state = { status: "loading", name: car.vehicles[i].name };
	}
	car.refreshing = true;
	selectPending = i;
	changed();
	flushRequests();
}

// ---------------------------------------------------------------------------
// Replies

function parseVehicles(str) {
	if (typeof str !== "string" || !str) return [];
	return str.split("\n").map(line => {
		const [name, last4] = line.split("\t");
		return { name: name || "Car", last4: last4 || "????" };
	});
}

function num(v, fallback) {
	return typeof v === "number" ? v : fallback;
}

// Shows a failed refresh's error in the footer for a few seconds, then goes
// back to the data's age, so the age stays visible while the data gets older.
let errorTimer;
function showLastError(error) {
	const errState = car.state;
	errState.lastError = error;
	if (errorTimer !== undefined) clearTimeout(errorTimer);
	errorTimer = setTimeout(() => {
		errorTimer = undefined;
		if (car.state !== errState) return; // replaced by newer data meanwhile
		delete errState.lastError;
		changed();
	}, ERROR_SHOW_MS);
}

const message = new Message({
	// Buffer sizes in bytes. The default (the maximum, 8 kB each way) would
	// take memory the app heap doesn't have to spare. The largest message is
	// the car list (VEHICLES) with a status; the watch only sends one number.
	input: 1024,
	output: 128,
	keys: ["REFRESH", "STATUS", "ERROR", "NAME", "LOCKED", "PLUGGED", "CHARGING",
		"CHARGE_STATUS", "SOC", "REMAIN_MIN", "DATA_TIME", "VEHICLES", "VEHICLE_INDEX",
		"SELECT_VEHICLE"],
	onReadable() {
		const msg = this.read();
		const status = msg.get("STATUS");
		if (msg.has("VEHICLES")) {
			car.vehicles = parseVehicles(msg.get("VEHICLES"));
			car.vehicleIndex = num(msg.get("VEHICLE_INDEX"), 0);
		}
		if (status === "loading") {
			// Sent after the settings changed: drop data of the old account.
			car.refreshing = true;
			car.state = { status };
			car.vehicles = [];
			closeWindows();
		} else if (status === "ok") {
			car.refreshing = false;
			car.state = {
				status,
				name: msg.get("NAME"),
				locked: num(msg.get("LOCKED"), -1),
				plugged: num(msg.get("PLUGGED"), -1),
				charging: num(msg.get("CHARGING"), 0) === 1,
				chargeStatus: msg.get("CHARGE_STATUS") || "",
				soc: num(msg.get("SOC"), -1),
				remainMin: num(msg.get("REMAIN_MIN"), 0),
				dataTime: num(msg.get("DATA_TIME"), -1),
			};
		} else if (status) {
			car.refreshing = false;
			// Keep showing the last good data if a later refresh fails.
			if (car.state.status === "ok" && status === "error") {
				showLastError(msg.get("ERROR"));
			} else {
				// An error keeps the car's name in the header.
				car.state = { status, name: status === "error" ? car.state.name : undefined, error: msg.get("ERROR") };
			}
			if (status === "nocreds") {
				car.vehicles = [];
				closeWindows();
			}
		}
		changed();
	},
	onWritable() {
		writable = true;
		flushRequests();
	},
	onSuspend() {
		writable = false;
	},
});

setInterval(requestRefresh, AUTO_REFRESH_MS);

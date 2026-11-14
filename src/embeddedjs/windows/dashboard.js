// The home window: a blue header with the car's name, then doors, charging and
// battery, and a footer with the data's age. It follows `car` on every
// onCarChanged, so it also shows the loading, no-credentials and error states.
//
// Select (or a tap on the refresh icon) refreshes; Down (or a tap on the car
// icon) opens the car picker when the account has more than one car.
import { FONT_KEY, textLayerStyle } from "pebble-ui/sdk";
import View from "pebble-ui/View";
import WindowStack from "pebble-ui/WindowStack";
import { car, requestRefresh } from "car";
import { TapBehavior } from "touch";

// The footer turns yellow once the car's data is older than this.
const STALE_AFTER_S = 60 * 60;

const BLUE = "#0055AA";
const WHITE = "#FFFFFF";
const GRAY = "#AAAAAA";
const DARK_GRAY = "#555555";
const GREEN = "#00AA55";
const RED = "#FF5555";
const YELLOW = "#FFAA00";

// Colours by name, for values: a Piu style or skin holds at most four colours
// as states, so values get one style per colour.
const COLORS = { white: WHITE, gray: GRAY, green: GREEN, red: RED, yellow: YELLOW };
// The footer's colours as states of its style.
const FOOTER_COLORS = [GRAY, YELLOW, RED];
const F = { gray: 0, yellow: 1, red: 2 };

// Glyph resources (package.json resources.media, from 1) and their states,
// one 36 px glyph per state stacked in the bitmap (tools/make_icons.py).
const RESOURCE = { lock: 2, plug: 3, bolt: 4, refresh: 5, car: 6 };
const LOCK = { locked: 0, unlocked: 1, unknown: 2 };
const PLUG = { plugged: 0, unplugged: 1 };
const GLYPH = 36;

const titleStyle = textLayerStyle(FONT_KEY.GOTHIC_24_BOLD, WHITE, "center");
const labelStyle = textLayerStyle(FONT_KEY.GOTHIC_14, GRAY);
const valueStyles = {};
for (const name in COLORS)
	valueStyles[name] = textLayerStyle(FONT_KEY.GOTHIC_24_BOLD, COLORS[name]);
const footerStyle = textLayerStyle(FONT_KEY.GOTHIC_14, FOOTER_COLORS, "center");
const bodyStyle = textLayerStyle(FONT_KEY.GOTHIC_18, WHITE, "center");
const errorStyle = textLayerStyle(FONT_KEY.GOTHIC_24_BOLD, RED, "center");

const headerSkin = new Skin({ fill: BLUE });
const backgroundSkin = new Skin({ fill: "#000000" });
const ruleSkin = new Skin({ fill: DARK_GRAY });
const whiteSkin = new Skin({ fill: WHITE });
const blackSkin = new Skin({ fill: "#000000" });
const batterySkins = { green: new Skin({ fill: GREEN }), yellow: new Skin({ fill: YELLOW }), red: new Skin({ fill: RED }) };

// ---------------------------------------------------------------------------
// Text helpers

// Shortens str with an ellipsis until it fits maxWidth.
function fitText(str, style, maxWidth) {
	if (style.measure(str).width <= maxWidth) return str;
	while (str.length > 1 && style.measure(str + "…").width > maxWidth)
		str = str.slice(0, -1);
	return str + "…";
}

function formatRemain(min) {
	if (!min) return "";
	const h = (min / 60) | 0;
	const m = min % 60;
	return h ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`;
}

// Age of the car's data in seconds; dataTime is in epoch seconds.
function dataAge(dataTime) {
	return Math.max(0, Date.now() / 1000 - dataTime);
}

// Formats an age in seconds, e.g. "5 min ago".
function formatAge(ageS) {
	const min = (ageS / 60) | 0;
	if (min < 1) return "just now";
	if (min < 60) return `${min} min ago`;
	const h = (min / 60) | 0;
	if (h < 24) return `${h} h ago`;
	const d = (h / 24) | 0;
	return d === 1 ? "1 day ago" : `${d} days ago`;
}

// The footer's text and colour for the current state.
function footer() {
	const s = car.state;
	if (car.refreshing)
		return ["Updating…", F.gray];
	if (s.lastError)
		return [fitText(`Update failed: ${s.lastError}`, footerStyle, screen.width - 12), F.red];
	if (s.dataTime >= 0) {
		const age = dataAge(s.dataTime);
		return [`Car data: ${formatAge(age)}`, age > STALE_AFTER_S ? F.yellow : F.gray];
	}
	return ["Car data: age unknown", F.gray];
}

// ---------------------------------------------------------------------------
// Header

function hasRefreshButton() {
	return car.state.status === "ok" || car.state.status === "error";
}

function hasCarButton() {
	return car.vehicles.length > 1 && car.state.status !== "nocreds";
}

function openPicker() {
	// The dashboard keeps the buttons while the picker slides in: open it once.
	const stack = WindowStack.current;
	if (!stack.depth)
		stack.push("picker");
}

// Tap targets in the header, 44 x 40 like the rows' icons plus a margin.
function tapTarget(action, where, icon) {
	return new Container(action, { ...where, top: 0, width: 44, height: 40, active: true, Behavior: TapBehavior, contents: [icon] });
}

function show(content, visible) {
	content.visible = visible;
	content.active = visible;
}

// ---------------------------------------------------------------------------
// Bodies: each status has its own contents, built when the status changes and
// then updated in place.

const ICON_X = 12;
const TEXT_X = 58;
const TEXT_WIDTH = screen.width - TEXT_X - 6;

// A row: the icon at the left, a small gray label and a bold value next to it.
function addRow(body, top, icon) {
	const row = {
		icon,
		label: new Label(null, { left: TEXT_X, width: TEXT_WIDTH, top: top + 1, style: labelStyle, string: "" }),
		value: new Label(null, { left: TEXT_X, width: TEXT_WIDTH, top: top + 13, style: valueStyles.gray, string: "" }),
	};
	body.add(row.icon);
	body.add(row.label);
	body.add(row.value);
	return row;
}

function setRow(row, label, value, color) {
	row.label.string = fitText(label, labelStyle, TEXT_WIDTH);
	row.value.style = valueStyles[color];
	row.value.string = fitText(value, valueStyles[color], TEXT_WIDTH);
}

function glyph(skin, top) {
	return new Content(null, { left: ICON_X, top: top + 4, skin });
}

// A battery outline with a nub; `fill` is its level bar.
function battery(top) {
	const fill = new Content(null, { left: 4, top: 4, width: 1, height: 10, skin: batterySkins.green, visible: false });
	const icon = new Container(null, {
		left: ICON_X, top: top + 13, width: 34, height: 18,
		contents: [
			new Content(null, { left: 0, top: 0, width: 30, height: 18, skin: whiteSkin }),
			new Content(null, { left: 2, top: 2, width: 26, height: 14, skin: blackSkin }),
			new Content(null, { left: 30, top: 5, width: 4, height: 8, skin: whiteSkin }),
			fill,
		],
	});
	icon.fill = fill;
	return icon;
}

// Fills the battery to pct in the given colour (green, yellow or red).
function setBattery(icon, pct, color) {
	const fill = icon.fill;
	fill.visible = pct > 0;
	if (pct > 0) {
		fill.coordinates = { left: 4, top: 4, width: Math.max(1, (22 * pct / 100) | 0), height: 10 };
		fill.skin = batterySkins[color];
	}
}

function message(body, text, top) {
	const content = new Text(null, { left: 10, right: 10, top, style: bodyStyle, string: text });
	body.add(content);
	return content;
}

const BODIES = {
	ok: {
		build(body, skins) {
			const parts = {
				doors: addRow(body, 44, glyph(skins.lock, 44)),
				charging: addRow(body, 96, glyph(skins.plug, 96)),
				battery: addRow(body, 148, battery(148)),
				footer: new Label(null, { left: 0, right: 0, top: 205, style: footerStyle, string: "" }),
			};
			body.add(new Content(null, { left: 8, right: 8, top: 200, height: 1, skin: ruleSkin }));
			body.add(parts.footer);
			return parts;
		},
		update(parts, skins) {
			const s = car.state;

			const doors = parts.doors;
			if (s.locked === 1) {
				doors.icon.state = LOCK.locked;
				setRow(doors, "Doors", "Locked", "green");
			}
			else if (s.locked === 0 || s.locked === 2) {
				doors.icon.state = LOCK.unlocked;
				setRow(doors, "Doors", s.locked ? "Door open" : "Unlocked", "red");
			}
			else {
				doors.icon.state = LOCK.unknown;
				setRow(doors, "Doors", "Unknown", "gray");
			}

			const charging = parts.charging;
			if (s.charging) {
				const remain = formatRemain(s.remainMin);
				charging.icon.skin = skins.bolt;
				charging.icon.state = 0;
				setRow(charging, remain ? `Charging · ${remain} left` : "Charging",
					s.chargeStatus === "fastCharging" ? "Fast charging" : "Charging", "yellow");
			}
			else {
				charging.icon.skin = skins.plug;
				charging.icon.state = s.plugged === 1 ? PLUG.plugged : PLUG.unplugged;
				if (s.plugged === 1)
					setRow(charging, "Charging", "Plugged in", "white");
				else
					setRow(charging, "Charging", s.plugged === 0 ? "Not plugged in" : "Unknown", "gray");
			}

			const batteryRow = parts.battery;
			if (s.soc >= 0) {
				const color = s.soc >= 50 ? "green" : (s.soc >= 20 ? "yellow" : "red");
				setBattery(batteryRow.icon, s.soc, color);
				setRow(batteryRow, "Battery", `${s.soc}%`, color);
			}
			else {
				setBattery(batteryRow.icon, 0);
				setRow(batteryRow, "Battery", "Unknown", "gray");
			}

			const [text, color] = footer();
			parts.footer.string = text;
			parts.footer.state = color;
		},
	},
	nocreds: {
		build(body) {
			message(body, "Open the app settings in the Pebble phone app and enter your Pleos API credentials.", 70);
		},
	},
	error: {
		build(body) {
			body.add(new Label(null, { left: 0, right: 0, top: 60, style: errorStyle, string: "Error" }));
			const parts = { error: message(body, "", 94) };
			body.add(new Label(null, { left: 0, right: 0, top: 205, style: footerStyle, state: F.gray, string: "Select: retry" }));
			return parts;
		},
		update(parts) {
			parts.error.string = car.state.error || "Unknown error";
		},
	},
	loading: {
		build(body) {
			message(body, "Loading vehicle data…", 100);
		},
	},
};

// ---------------------------------------------------------------------------
// Window

class DashboardBehavior extends View.Behavior {
	onCreate(container, view) {
		super.onCreate(container, view);
		const skins = view.skins;
		this.body = new Container(null, { left: 0, right: 0, top: 0, bottom: 0 });
		this.title = new Label(null, { left: 0, right: 0, top: 2, style: titleStyle, string: "" });
		this.refreshIcon = new Content(null, { left: 0, top: 0, skin: skins.refresh });
		this.refreshTap = tapTarget(requestRefresh, { left: 0 }, this.refreshIcon);
		this.carTap = tapTarget(openPicker, { right: 0 }, new Content(null, { right: 0, top: 0, skin: skins.car }));
		container.add(new Content(null, { left: 0, right: 0, top: 0, height: 36, skin: headerSkin }));
		container.add(this.body);
		container.add(this.title);
		container.add(this.refreshTap);
		container.add(this.carTap);
		this.update();
	}
	// Brings the window up to date with `car`: the body's contents are made
	// again only when the status changes.
	update() {
		const s = car.state, withRefresh = hasRefreshButton(), withCar = hasCarButton();
		show(this.refreshTap, withRefresh);
		this.refreshIcon.state = car.refreshing ? 1 : 0;
		show(this.carTap, withCar);
		// The title stays centred, so keep clear of buttons on both sides.
		const maxWidth = screen.width - (withRefresh || withCar ? 72 : 12);
		this.title.string = fitText(s.name || (s.status === "ok" ? "My car" : "CarGlance"), titleStyle, maxWidth);

		const body = BODIES[s.status] ?? BODIES.loading;
		if (body !== this.shown) {
			this.shown = body;
			this.body.empty();
			this.parts = body.build(this.body, this.view.skins);
		}
		body.update?.(this.parts, this.view.skins);
	}
	onCarChanged(container) {
		this.update();
	}
	// Keeps the data's age current between refreshes.
	onMinuteChanged(container) {
		this.update();
	}
	onPressSelect(container) {
		requestRefresh();
		return true;
	}
	onPressDown(container) {
		if (hasCarButton())
			openPicker();
		return true;
	}
}

const DashboardContainer = Container.template($ => ({
	left: 0, right: 0, top: 0, bottom: 0, skin: backgroundSkin, Behavior: $.constructor.Behavior,
}));

export default class Dashboard extends View {
	static get Behavior() { return DashboardBehavior }
	constructor(data) {
		super(data);
		// Bitmaps live in the app heap while their skins do: made per window.
		const glyph = (id) => new Skin({ texture: new Texture(id), x: 0, y: 0, width: GLYPH, height: GLYPH, states: GLYPH });
		this.skins = {
			lock: glyph(RESOURCE.lock), plug: glyph(RESOURCE.plug), bolt: glyph(RESOURCE.bolt),
			refresh: glyph(RESOURCE.refresh), car: glyph(RESOURCE.car),
		};
	}
	get Template() { return DashboardContainer }
}

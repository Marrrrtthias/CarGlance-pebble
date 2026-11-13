// The home window: a blue header with the car's name, then doors, charging and
// battery, and a footer with the data's age. It is rebuilt from `car` on every
// onCarChanged, so it also shows the loading, no-credentials and error states.
//
// Select (or a tap on the refresh icon) refreshes; Down (or a tap on the car
// icon) opens the car picker when the account has more than one car.
import { FONT_KEY } from "pebble-ui/sdk";
import View from "pebble-ui/View";
import WindowStack from "pebble-ui/WindowStack";
import { car, requestRefresh } from "car";

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

// Text positions are where Poco's drawText put them in earlier versions, which
// is also where Piu draws (pebble-ui's textLayerStyle would add a TextLayer's
// offsets).
function textStyle(font, color, horizontal = "left") {
	return new Style({ font, color, horizontal, vertical: "top" });
}

const titleStyle = textStyle(FONT_KEY.GOTHIC_24_BOLD, WHITE, "center");
const labelStyle = textStyle(FONT_KEY.GOTHIC_14, GRAY);
const valueStyles = {};
for (const name in COLORS)
	valueStyles[name] = textStyle(FONT_KEY.GOTHIC_24_BOLD, COLORS[name]);
const footerStyle = textStyle(FONT_KEY.GOTHIC_14, FOOTER_COLORS, "center");
const bodyStyle = textStyle(FONT_KEY.GOTHIC_18, WHITE, "center");
const errorStyle = textStyle(FONT_KEY.GOTHIC_24_BOLD, RED, "center");

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
	WindowStack.current.push("picker");
}

function inside(content, x, y) {
	return x >= content.x && x < content.x + content.width && y >= content.y && y < content.y + content.height;
}

// A tap counts when it starts and ends inside the target.
class TapBehavior extends Behavior {
	onCreate(content, action) {
		this.action = action;
	}
	onTouchBegan(content, id, x, y) {
		this.began = inside(content, x, y);
	}
	onTouchEnded(content, id, x, y) {
		if (this.began && inside(content, x, y))
			this.action();
	}
}

// Tap targets in the header, 44 x 40 like the rows' icons plus a margin.
function tapTarget(action, where, icon) {
	return new Container(action, { ...where, top: 0, width: 44, height: 40, active: true, Behavior: TapBehavior, contents: [icon] });
}

function header(view) {
	const withRefresh = hasRefreshButton(), withCar = hasCarButton();
	// The title stays centred, so keep clear of buttons on both sides.
	const maxWidth = screen.width - (withRefresh || withCar ? 72 : 12);
	return [
		new Content(null, { left: 0, right: 0, top: 0, height: 36, skin: headerSkin }),
		new Label(null, {
			left: 0, right: 0, top: 2, style: titleStyle,
			string: fitText(car.state.name || (car.state.status === "ok" ? "My car" : "CarGlance"), titleStyle, maxWidth),
		}),
		withRefresh ? tapTarget(requestRefresh, { left: 0 },
			new Content(null, { left: 0, top: 0, skin: view.skins.refresh, state: car.refreshing ? 1 : 0 })) : null,
		withCar ? tapTarget(openPicker, { right: 0 },
			new Content(null, { right: 0, top: 0, skin: view.skins.car })) : null,
	];
}

// ---------------------------------------------------------------------------
// Bodies

const ICON_X = 12;
const TEXT_X = 58;
const TEXT_WIDTH = screen.width - TEXT_X - 6;

// A row: the icon at the left, a small gray label and a bold value next to it.
function row(top, icon, label, value, color) {
	return [
		icon,
		new Label(null, { left: TEXT_X, width: TEXT_WIDTH, top: top + 1, style: labelStyle, string: fitText(label, labelStyle, TEXT_WIDTH) }),
		new Label(null, { left: TEXT_X, width: TEXT_WIDTH, top: top + 13, style: valueStyles[color], string: fitText(value, valueStyles[color], TEXT_WIDTH) }),
	];
}

function glyph(skin, top, state = 0) {
	return new Content(null, { left: ICON_X, top: top + 4, skin, state });
}

// A battery outline with a nub, filled to pct in the given colour (green,
// yellow or red).
function battery(top, pct, color) {
	const fill = pct > 0 ? Math.max(1, (22 * pct / 100) | 0) : 0;
	return new Container(null, {
		left: ICON_X, top: top + 13, width: 34, height: 18,
		contents: [
			new Content(null, { left: 0, top: 0, width: 30, height: 18, skin: whiteSkin }),
			new Content(null, { left: 2, top: 2, width: 26, height: 14, skin: blackSkin }),
			new Content(null, { left: 30, top: 5, width: 4, height: 8, skin: whiteSkin }),
			fill ? new Content(null, { left: 4, top: 4, width: fill, height: 10, skin: batterySkins[color] }) : null,
		],
	});
}

function dashboard(view) {
	const s = car.state, skins = view.skins;
	const contents = [];

	let top = 44;
	if (s.locked === 1)
		contents.push(...row(top, glyph(skins.lock, top, LOCK.locked), "Doors", "Locked", "green"));
	else if (s.locked === 0)
		contents.push(...row(top, glyph(skins.lock, top, LOCK.unlocked), "Doors", "Unlocked", "red"));
	else if (s.locked === 2)
		contents.push(...row(top, glyph(skins.lock, top, LOCK.unlocked), "Doors", "Door open", "red"));
	else
		contents.push(...row(top, glyph(skins.lock, top, LOCK.unknown), "Doors", "Unknown", "gray"));

	top = 96;
	if (s.charging) {
		const remain = formatRemain(s.remainMin);
		contents.push(...row(top, glyph(skins.bolt, top), remain ? `Charging · ${remain} left` : "Charging",
			s.chargeStatus === "fastCharging" ? "Fast charging" : "Charging", "yellow"));
	}
	else if (s.plugged === 1)
		contents.push(...row(top, glyph(skins.plug, top, PLUG.plugged), "Charging", "Plugged in", "white"));
	else if (s.plugged === 0)
		contents.push(...row(top, glyph(skins.plug, top, PLUG.unplugged), "Charging", "Not plugged in", "gray"));
	else
		contents.push(...row(top, glyph(skins.plug, top, PLUG.unplugged), "Charging", "Unknown", "gray"));

	top = 148;
	if (s.soc >= 0) {
		const color = s.soc >= 50 ? "green" : (s.soc >= 20 ? "yellow" : "red");
		contents.push(...row(top, battery(top, s.soc, color), "Battery", `${s.soc}%`, color));
	}
	else
		contents.push(...row(top, battery(top, 0), "Battery", "Unknown", "gray"));

	const [text, color] = footer();
	contents.push(
		new Content(null, { left: 8, right: 8, top: 200, height: 1, skin: ruleSkin }),
		new Label(null, { left: 0, right: 0, top: 205, style: footerStyle, state: color, string: text, name: "footer" }),
	);
	return contents;
}

function message(text, top) {
	return new Text(null, { left: 10, right: 10, top, style: bodyStyle, string: text });
}

function body(view) {
	switch (car.state.status) {
	case "ok":
		return dashboard(view);
	case "nocreds":
		return [message("Open the app settings in the Pebble phone app and enter your Pleos API credentials.", 70)];
	case "error":
		return [
			new Label(null, { left: 0, right: 0, top: 60, style: errorStyle, string: "Error" }),
			message(car.state.error || "Unknown error", 94),
			new Label(null, { left: 0, right: 0, top: 205, style: footerStyle, state: F.gray, string: "Select: retry" }),
		];
	default:
		return [message("Loading vehicle data…", 100)];
	}
}

// ---------------------------------------------------------------------------
// Window

class DashboardBehavior extends View.Behavior {
	onCreate(container, view) {
		super.onCreate(container, view);
		this.build(container);
	}
	build(container) {
		container.empty();
		for (const content of [...header(this.view), ...body(this.view)])
			if (content)
				container.add(content);
	}
	onCarChanged(container) {
		this.build(container);
	}
	// Keeps the data's age current between refreshes.
	onMinuteChanged(container) {
		const label = container.content("footer");
		if (label && car.state.status === "ok") {
			const [text, color] = footer();
			label.string = text;
			label.state = color;
		}
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

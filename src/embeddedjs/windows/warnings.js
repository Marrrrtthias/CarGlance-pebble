// The car's warnings: a yellow header, one two-line row per warning (what it
// is, and where or what to do), and the data's age at the bottom. Up/Down
// move through the rows, Back returns to the dashboard. The window closes by
// itself once the car reports no more warnings.
import { FONT_KEY, GColor, textLayerStyle } from "pebble-ui/sdk";
import Menu from "pebble-ui/Menu";
import View from "pebble-ui/View";
import WindowStack from "pebble-ui/WindowStack";
import { car } from "car";
import { footer, footerStyle } from "dashboard";

const YELLOW = "#FFAA00";
const CELL = 44;

const titleStyle = textLayerStyle(FONT_KEY.GOTHIC_24_BOLD, GColor.Black, "center");
// Row text as [normal, highlighted] states, which the menu switches.
const rowTitleStyle = textLayerStyle(FONT_KEY.GOTHIC_18_BOLD, GColor.White);
const rowDetailStyle = textLayerStyle(FONT_KEY.GOTHIC_14, [GColor.LightGray, GColor.White]);

const WarningItem = Container.template($ => ({
	left: 0, right: 0,
	contents: [
		Label($, { left: 8, right: 4, top: 2, style: rowTitleStyle, string: $.item.title }),
		Label($, { left: 8, right: 4, top: 22, style: rowDetailStyle, string: $.item.detail }),
	],
}));

function warnings() {
	return car.state.status === "ok" ? car.state.warnings : [];
}

class WarningsBehavior extends View.Behavior {
	onCreate(container, view) {
		super.onCreate(container, view);
		this.menu = container.content("menu");
	}
	// The embedded menu lays out its rows and moves the selection; this window
	// only forwards the keys (the menu may also have the focus itself).
	onDisplaying(container) {
		this.menu.behavior.place(this.menu, false);
	}
	onPressUp(container) {
		this.menu.delegate("onPressUp");
		return true;
	}
	onPressDown(container) {
		this.menu.delegate("onPressDown");
		return true;
	}
	onReleaseUp(container) {
		this.menu.delegate("onReleaseUp");
		return true;
	}
	onReleaseDown(container) {
		this.menu.delegate("onReleaseDown");
		return true;
	}
	onPressSelect(container) {
		return true;
	}
	onCarChanged(container) {
		if (!warnings().length)
			WindowStack.current.pop();
		else
			this.onMinuteChanged(container);
	}
	onMinuteChanged(container) {
		const [text, color] = footer();
		const label = container.content("footer");
		label.string = text;
		label.state = color;
	}
}

const WarningsContainer = Container.template($ => ({
	left: 0, right: 0, top: 0, bottom: 0, skin: new Skin({ fill: GColor.Black }), Behavior: $.constructor.Behavior,
	contents: [
		Content($, { left: 0, right: 0, top: 0, height: 36, skin: new Skin({ fill: YELLOW }) }),
		Label($, { left: 0, right: 0, top: 2, style: titleStyle, string: "Warnings" }),
		new $.menu.Template($.menu, { left: 0, right: 0, top: 36, height: 164, name: "menu" }),
		Content($, { left: 8, right: 8, top: 200, height: 1, skin: new Skin({ fill: GColor.DarkGray }) }),
		Label($, { left: 0, right: 0, top: 205, style: footerStyle, state: footer()[1], string: footer()[0], name: "footer" }),
	],
}));

export default class Warnings extends View {
	static get Behavior() { return WarningsBehavior }
	constructor(data) {
		super(data);
		this.menu = new Menu({
			items: warnings(),
			cellHeight: CELL,
			fixed: true,
			Item: WarningItem,
			normal: [GColor.Black, GColor.White],
			highlight: [GColor.DarkGray, GColor.White],
		});
	}
	get Template() { return WarningsContainer }
}

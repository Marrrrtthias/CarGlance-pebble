// The car picker: one two-line row per car, its name and the last digits of
// its VIN, opening on the car shown. Up/Down and Select pick a car, Back
// closes the picker. On touch, a tap picks a row and a vertical drag scrolls.
import { GColor } from "pebble-ui/sdk";
import SubtitleMenu from "pebble-ui/subtitles";
import WindowStack from "pebble-ui/WindowStack";
import { car, pickVehicle } from "car";
import { inside } from "touch";

const DRAG = 20; // px a touch moves before it scrolls instead of tapping

class PickerBehavior extends SubtitleMenu.Behavior {
	onCreate(menu, view) {
		super.onCreate(menu, view);
		menu.active = true;
	}
	onTouchBegan(menu, id, x, y) {
		this.touchY = y;
	}
	onTouchEnded(menu, id, x, y) {
		// Only a touch that began on this window counts (not one that began on
		// the dashboard while the picker slid in).
		const startY = this.touchY;
		this.touchY = undefined;
		if (startY === undefined)
			return;
		const dy = y - startY;
		if (Math.abs(dy) > DRAG) {
			// Dragging up moves the selection down, a row per cell height.
			this.step(menu, -Math.round(dy / this.view.cellHeight) || (dy < 0 ? 1 : -1));
			return;
		}
		let index = 0;
		for (let row = menu.last.first; row; row = row.next, index++) {
			if (inside(row, x, startY) && inside(row, x, y)) {
				this.view.selection = index;
				this.place(menu, false);
				this.onPressSelect(menu);
				return;
			}
		}
	}
}

export default class Picker extends SubtitleMenu {
	static get Behavior() { return PickerBehavior }
	constructor() {
		super({
			items: car.vehicles.map(v => ({ title: v.name, subtitle: `VIN …${v.last4}` })),
			selection: Math.max(0, Math.min(car.vehicleIndex, car.vehicles.length - 1)),
			normal: [GColor.Black, GColor.White],
			highlight: [GColor.DarkGray, GColor.White],
			onSelect(index) {
				WindowStack.current.pop();
				pickVehicle(index);
			},
		});
	}
}

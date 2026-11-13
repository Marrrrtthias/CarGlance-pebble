// The car picker: one two-line row per car, its name and the last digits of
// its VIN, opening on the car shown. Up/Down and Select pick a car, Back
// closes the picker. On touch, a tap picks a row and a vertical drag scrolls.
import { GColor } from "pebble-ui/sdk";
import SubtitleMenu from "pebble-ui/subtitles";
import WindowStack from "pebble-ui/WindowStack";
import { car, pickVehicle } from "car";

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
		const dy = y - this.touchY;
		if (Math.abs(dy) > DRAG) {
			// Dragging up moves the selection down, a row per cell height.
			this.step(menu, -Math.round(dy / this.view.cellHeight) || (dy < 0 ? 1 : -1));
			return;
		}
		let index = 0;
		for (let row = menu.last.first; row; row = row.next, index++) {
			if (this.touchY >= row.y && this.touchY < row.y + row.height && y >= row.y && y < row.y + row.height) {
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
			selection: Math.min(car.vehicleIndex, car.vehicles.length - 1),
			normal: [GColor.Black, GColor.White],
			highlight: [GColor.DarkGray, GColor.White],
			onSelect(index) {
				WindowStack.current.pop();
				pickVehicle(index);
			},
		});
	}
}

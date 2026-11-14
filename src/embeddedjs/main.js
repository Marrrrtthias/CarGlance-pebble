// CarGlance for Hyundai, Kia & Genesis: vehicle dashboard (lock, charging,
// battery) for Pebble Time 2.
//
// The screens are pebble-ui windows (Piu) on a window stack: the dashboard
// (windows/dashboard.js) and the car picker (windows/picker.js). car.js talks
// to the phone, which does all network access (src/pkjs/index.js).
import WindowStack from "pebble-ui/WindowStack";
import "car";

const App = Application.template($ => ({ behavior: new WindowStack }));

export default new App(
	{ View: "dashboard" },
	{ commandListLength: 1024, displayListLength: 1024, touchCount: 1, pixels: screen.width * 4 },
);

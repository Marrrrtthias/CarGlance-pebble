// CarGlance for Hyundai, Kia & Genesis: vehicle dashboard (lock, charging,
// battery) for Pebble Time 2.
// All network access happens on the phone (src/pkjs/index.js); the watch only
// renders what it receives and asks for refreshes.
import Poco from "commodetto/Poco";
import Message from "pebble/message";
import Button from "pebble/button";
import Touch from "embedded:sensor/Touch/pebble";

const AUTO_REFRESH_MS = 10 * 60 * 1000;

const render = new Poco(screen);

const titleFont = new render.Font("Gothic-Bold", 24);
const valueFont = new render.Font("Gothic-Bold", 24);
const labelFont = new render.Font("Gothic-Regular", 14);
const bodyFont = new render.Font("Gothic-Regular", 18);

const black = render.makeColor(0, 0, 0);
const white = render.makeColor(255, 255, 255);
const gray = render.makeColor(170, 170, 170);
const darkGray = render.makeColor(85, 85, 85);
const blue = render.makeColor(0, 85, 170);
const green = render.makeColor(0, 170, 85);
const yellow = render.makeColor(255, 170, 0);
const red = render.makeColor(255, 85, 85);

// "loading" | "ok" | "nocreds" | "error"
let state = { status: "loading" };
let refreshing = true;

// Cars on the account ({ name, last4 }) and the index of the shown one.
let vehicles = [];
let vehicleIndex = 0;

// "main" | "picker"
let screenMode = "main";
let pickerIndex = 0;  // highlighted row
let pickerScroll = 0; // first visible row

// ---------------------------------------------------------------------------
// Icons (drawn from primitives, 36x36 box with top-left at x, y)

function drawRing(color, cx, cy, outer, inner) {
    render.drawCircle(color, cx, cy, outer, 0, 360);
    render.drawCircle(black, cx, cy, inner, 0, 360);
}

function drawLock(x, y, locked, color) {
    const cx = x + 18;
    // Shackle: raised when unlocked.
    const shackleY = locked ? y + 13 : y + 8;
    drawRing(color, cx, shackleY, 10, 5);
    if (!locked) {
        // Cut the left leg so it reads as an open shackle.
        render.fillRectangle(black, cx - 10, shackleY, 6, y + 16 - shackleY);
    }
    render.fillRectangle(color, x + 6, y + 15, 24, 19);
    // Keyhole.
    render.drawCircle(black, cx, y + 23, 3, 0, 360);
    render.fillRectangle(black, cx - 1, y + 24, 3, 6);
}

function drawBolt(x, y, color) {
    const cx = x + 18;
    render.drawLine(cx + 6, y + 2, cx - 6, y + 19, color, 4);
    render.drawLine(cx - 6, y + 19, cx + 6, y + 17, color, 4);
    render.drawLine(cx + 6, y + 17, cx - 6, y + 34, color, 4);
}

function drawPlug(x, y, color) {
    const cx = x + 18;
    render.fillRectangle(color, cx - 7, y + 2, 3, 9);   // prongs
    render.fillRectangle(color, cx + 5, y + 2, 3, 9);
    render.drawRoundRect(cx - 11, y + 10, 23, 14, color, 4);
    render.fillRectangle(color, cx - 2, y + 24, 5, 11); // cable
}

// Circular arrow (refresh), centered on cx, cy; bg fills the ring's hole.
function drawRefresh(cx, cy, color, bg) {
    render.drawCircle(color, cx, cy, 11, 70, 360);
    render.drawCircle(bg, cx, cy, 7, 0, 360);
    // Arrowhead at 12 o'clock, pointing clockwise.
    render.drawLine(cx + 5, cy - 9, cx - 1, cy - 15, color, 3);
    render.drawLine(cx + 5, cy - 9, cx - 1, cy - 3, color, 3);
}

// Front-left view of a car, centered on cx, cy; bg fills the windows.
function drawCar(cx, cy, color, bg) {
    render.drawRoundRect(cx - 8, cy - 9, 16, 9, color, 3);  // cabin
    render.fillRectangle(bg, cx - 5, cy - 6, 4, 5);         // windows
    render.fillRectangle(bg, cx + 1, cy - 6, 4, 5);
    render.drawRoundRect(cx - 13, cy - 1, 26, 9, color, 3); // body
    render.drawCircle(bg, cx - 7, cy + 8, 4, 0, 360);       // wheel arches
    render.drawCircle(bg, cx + 7, cy + 8, 4, 0, 360);
    render.drawCircle(color, cx - 7, cy + 8, 3, 0, 360);    // wheels
    render.drawCircle(color, cx + 7, cy + 8, 3, 0, 360);
}

function drawBattery(x, y, pct, color) {
    const w = 30, h = 18, top = y + 9;
    render.fillRectangle(white, x, top, w, h);
    render.fillRectangle(black, x + 2, top + 2, w - 4, h - 4);
    render.fillRectangle(white, x + w, top + 5, 4, h - 10);
    if (pct > 0) {
        const fill = Math.max(1, ((w - 8) * pct / 100) | 0);
        render.fillRectangle(color, x + 4, top + 4, fill, h - 8);
    }
}

// ---------------------------------------------------------------------------
// Layout helpers

function centerText(str, font, color, y) {
    const w = render.getTextWidth(str, font);
    render.drawText(str, font, color, ((render.width - w) / 2) | 0, y);
}

function fitText(str, font, maxWidth) {
    if (render.getTextWidth(str, font) <= maxWidth) return str;
    while (str.length > 1 && render.getTextWidth(str + "…", font) > maxWidth) {
        str = str.slice(0, -1);
    }
    return str + "…";
}

function wrapText(str, font, maxWidth) {
    const lines = [];
    let line = "";
    for (const word of str.split(" ")) {
        const candidate = line ? line + " " + word : word;
        if (line && render.getTextWidth(candidate, font) > maxWidth) {
            lines.push(line);
            line = word;
        } else {
            line = candidate;
        }
    }
    if (line) lines.push(line);
    return lines;
}

function drawCenteredMessage(str, color, top) {
    const lines = wrapText(str, bodyFont, render.width - 20);
    let y = top;
    for (const l of lines) {
        centerText(l, bodyFont, color, y);
        y += bodyFont.height;
    }
}

function formatRemain(min) {
    if (!min) return "";
    const h = (min / 60) | 0;
    const m = min % 60;
    return h ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`;
}

// Row: icon at the left, small gray label and a bold value next to it.
const ICON_X = 12;
const TEXT_X = 58;
function drawRow(top, label, value, valueColor) {
    const maxW = render.width - TEXT_X - 6;
    render.drawText(fitText(label, labelFont, maxW), labelFont, gray, TEXT_X, top + 1);
    render.drawText(fitText(value, valueFont, maxW), valueFont, valueColor, TEXT_X, top + 13);
}

// ---------------------------------------------------------------------------
// Screens

// Tap targets in the header: refresh top-left, car picker top-right.
const REFRESH_BTN = { x: 0, y: 0, w: 44, h: 40 };
const CAR_BTN = { x: render.width - 44, y: 0, w: 44, h: 40 };

function hasRefreshButton() {
    return state.status === "ok" || state.status === "error";
}

function hasCarButton() {
    return vehicles.length > 1 && state.status !== "nocreds";
}

function drawHeader(title, withRefresh, withCar) {
    render.fillRectangle(blue, 0, 0, render.width, 36);
    if (withRefresh) drawRefresh(18, 18, refreshing ? gray : white, blue);
    if (withCar) drawCar(render.width - 18, 17, white, blue);
    // The title stays centered, so keep clear of buttons on both sides.
    const maxW = render.width - (withRefresh || withCar ? 72 : 12);
    centerText(fitText(title, titleFont, maxW), titleFont, white, 2);
}

function drawDashboard() {
    const s = state;

    // Lock row (y 44..90)
    let top = 44;
    if (s.locked === 1) {
        drawLock(ICON_X, top + 4, true, green);
        drawRow(top, "Doors", "Locked", green);
    } else if (s.locked === 0) {
        drawLock(ICON_X, top + 4, false, red);
        drawRow(top, "Doors", "Unlocked", red);
    } else if (s.locked === 2) {
        drawLock(ICON_X, top + 4, false, red);
        drawRow(top, "Doors", "Door open", red);
    } else {
        drawLock(ICON_X, top + 4, true, darkGray);
        drawRow(top, "Doors", "Unknown", gray);
    }

    // Charging row (y 96..142)
    top = 96;
    if (s.charging) {
        const fast = s.chargeStatus === "fastCharging";
        const remain = formatRemain(s.remainMin);
        drawBolt(ICON_X, top + 4, yellow);
        drawRow(top, remain ? `Charging · ${remain} left` : "Charging",
            fast ? "Fast charging" : "Charging", yellow);
    } else if (s.plugged === 1) {
        drawPlug(ICON_X, top + 4, white);
        drawRow(top, "Charging", "Plugged in", white);
    } else if (s.plugged === 0) {
        drawPlug(ICON_X, top + 4, darkGray);
        drawRow(top, "Charging", "Not plugged in", gray);
    } else {
        drawPlug(ICON_X, top + 4, darkGray);
        drawRow(top, "Charging", "Unknown", gray);
    }

    // Battery row (y 148..194)
    top = 148;
    if (s.soc >= 0) {
        const color = s.soc >= 50 ? green : (s.soc >= 20 ? yellow : red);
        drawBattery(ICON_X, top + 4, s.soc, color);
        drawRow(top, "Battery", `${s.soc}%`, color);
    } else {
        drawBattery(ICON_X, top + 4, 0, darkGray);
        drawRow(top, "Battery", "Unknown", gray);
    }

    // Footer (y 204..222)
    render.fillRectangle(darkGray, 8, 200, render.width - 16, 1);
    if (refreshing) {
        centerText("Updating…", labelFont, gray, 205);
    } else if (s.lastError) {
        centerText(fitText(`Update failed: ${s.lastError}`, labelFont, render.width - 12), labelFont, red, 205);
    } else {
        centerText(`Updated ${s.updated || "--:--"}`, labelFont, gray, 205);
    }
}

// Car picker: one row per car with its name and the last VIN digits.
const PICKER_TOP = 40;
const PICKER_ROW_H = 46;
const PICKER_ROWS = ((render.height - PICKER_TOP) / PICKER_ROW_H) | 0;

function drawPicker() {
    drawHeader("Select car", false, false);
    for (let row = 0; row < PICKER_ROWS; row++) {
        const i = pickerScroll + row;
        if (i >= vehicles.length) break;
        const v = vehicles[i];
        const top = PICKER_TOP + row * PICKER_ROW_H;
        const highlighted = i === pickerIndex;
        if (highlighted) render.fillRectangle(darkGray, 0, top, render.width, PICKER_ROW_H - 2);
        if (i === vehicleIndex) render.fillRectangle(green, 0, top, 4, PICKER_ROW_H - 2);
        const maxW = render.width - 20;
        render.drawText(fitText(v.name, valueFont, maxW), valueFont, white, 12, top + 2);
        render.drawText(`VIN …${v.last4}`, labelFont, highlighted ? white : gray, 12, top + 27);
    }
    // Hint that more cars are above or below.
    if (pickerScroll > 0) {
        render.fillRectangle(gray, render.width - 8, PICKER_TOP + 2, 4, 4);
    }
    if (pickerScroll + PICKER_ROWS < vehicles.length) {
        render.fillRectangle(gray, render.width - 8, render.height - 8, 4, 4);
    }
}

function draw() {
    render.begin();
    render.fillRectangle(black, 0, 0, render.width, render.height);

    if (screenMode === "picker") {
        drawPicker();
    } else if (state.status === "ok") {
        drawHeader(state.name || "My car", true, hasCarButton());
        drawDashboard();
    } else {
        drawHeader(state.name || "CarGlance", hasRefreshButton(), hasCarButton());
        if (state.status === "nocreds") {
            drawCenteredMessage("Open the app settings in the Pebble phone app and enter your Pleos API credentials.", white, 70);
        } else if (state.status === "error") {
            centerText("Error", valueFont, red, 60);
            drawCenteredMessage(state.error || "Unknown error", white, 94);
            centerText("Select: retry", labelFont, gray, 205);
        } else {
            drawCenteredMessage("Loading vehicle data…", white, 100);
        }
    }

    render.end();
}

// ---------------------------------------------------------------------------
// Phone communication

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

function requestRefresh() {
    refreshing = true;
    draw();
    refreshPending = true;
    flushRequests();
}

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

const message = new Message({
    keys: ["REFRESH", "STATUS", "ERROR", "NAME", "LOCKED", "PLUGGED", "CHARGING",
        "CHARGE_STATUS", "SOC", "REMAIN_MIN", "UPDATED", "VEHICLES", "VEHICLE_INDEX",
        "SELECT_VEHICLE"],
    onReadable() {
        const msg = this.read();
        const status = msg.get("STATUS");
        if (msg.has("VEHICLES")) {
            vehicles = parseVehicles(msg.get("VEHICLES"));
            vehicleIndex = num(msg.get("VEHICLE_INDEX"), 0);
        }
        if (status === "loading") {
            // Sent after the settings changed: drop data of the old account.
            refreshing = true;
            state = { status };
            vehicles = [];
            closePicker();
        } else if (status === "ok") {
            refreshing = false;
            state = {
                status,
                name: msg.get("NAME"),
                locked: num(msg.get("LOCKED"), -1),
                plugged: num(msg.get("PLUGGED"), -1),
                charging: num(msg.get("CHARGING"), 0) === 1,
                chargeStatus: msg.get("CHARGE_STATUS") || "",
                soc: num(msg.get("SOC"), -1),
                remainMin: num(msg.get("REMAIN_MIN"), 0),
                updated: msg.get("UPDATED")
            };
        } else if (status) {
            refreshing = false;
            // Keep showing the last good data if a later refresh fails.
            if (state.status === "ok" && status === "error") {
                state.lastError = msg.get("ERROR");
            } else {
                // An error keeps the car's name in the header.
                state = { status, name: status === "error" ? state.name : undefined, error: msg.get("ERROR") };
            }
            if (status === "nocreds") {
                vehicles = [];
                closePicker();
            }
        }
        draw();
    },
    onWritable() {
        writable = true;
        flushRequests();
    },
    onSuspend() {
        writable = false;
    }
});

// ---------------------------------------------------------------------------
// Car picker

// Subscribed only while the picker is open, so Back still exits the app from
// the overview.
let backButton = null;

function openPicker() {
    screenMode = "picker";
    pickerIndex = Math.min(vehicleIndex, vehicles.length - 1);
    pickerScroll = 0;
    movePicker(0);
    if (!backButton) {
        backButton = new Button({
            type: "back",
            onPush(down) {
                if (down) {
                    closePicker();
                    draw();
                }
            }
        });
    }
    draw();
}

function closePicker() {
    screenMode = "main";
    if (backButton) {
        backButton.close();
        backButton = null;
    }
}

// Moves the highlight and scrolls it into view.
function movePicker(delta) {
    pickerIndex = Math.max(0, Math.min(vehicles.length - 1, pickerIndex + delta));
    if (pickerIndex < pickerScroll) pickerScroll = pickerIndex;
    if (pickerIndex >= pickerScroll + PICKER_ROWS) pickerScroll = pickerIndex - PICKER_ROWS + 1;
}

function scrollPicker(rows) {
    const maxScroll = Math.max(0, vehicles.length - PICKER_ROWS);
    pickerScroll = Math.max(0, Math.min(maxScroll, pickerScroll + rows));
    pickerIndex = Math.max(pickerScroll, Math.min(pickerScroll + PICKER_ROWS - 1, pickerIndex));
}

function pickVehicle(i) {
    closePicker();
    if (i !== vehicleIndex) {
        vehicleIndex = i;
        // Show the new car's name right away; its data follows.
        state = { status: "loading", name: vehicles[i].name };
    }
    refreshing = true;
    selectPending = i;
    draw();
    flushRequests();
}

function pickerRowAt(p) {
    if (p.y < PICKER_TOP) return -1;
    const row = ((p.y - PICKER_TOP) / PICKER_ROW_H) | 0;
    const i = pickerScroll + row;
    return row < PICKER_ROWS && i < vehicles.length ? i : -1;
}

// ---------------------------------------------------------------------------
// Input

new Button({
    types: ["select", "up", "down"],
    onPush(down, type) {
        if (!down) return;
        if (screenMode === "picker") {
            if (type === "select") {
                pickVehicle(pickerIndex);
            } else {
                movePicker(type === "up" ? -1 : 1);
                draw();
            }
        } else if (type === "select") {
            requestRefresh();
        }
    }
});

function inRect(r, p) {
    return p.x >= r.x && p.x < r.x + r.w && p.y >= r.y && p.y < r.y + r.h;
}

// A tap counts when it starts and ends inside the same target; in the picker
// a vertical drag scrolls the list instead.
let touchStart = null;
let touchLast = null;
new Touch({
    onSample() {
        const points = this.sample();
        if (!points) return;
        if (points.length) {
            touchLast = points[0];
            if (!touchStart) touchStart = touchLast;
            return;
        }
        const start = touchStart, end = touchLast;
        touchStart = touchLast = null;
        if (!start) return;

        if (screenMode === "picker") {
            const dy = end.y - start.y;
            if (Math.abs(dy) > 20) {
                scrollPicker(-Math.round(dy / PICKER_ROW_H) || (dy < 0 ? 1 : -1));
                draw();
                return;
            }
            const i = pickerRowAt(start);
            if (i >= 0 && i === pickerRowAt(end)) pickVehicle(i);
            return;
        }

        if (hasRefreshButton() && inRect(REFRESH_BTN, start) && inRect(REFRESH_BTN, end)) {
            requestRefresh();
        } else if (hasCarButton() && inRect(CAR_BTN, start) && inRect(CAR_BTN, end)) {
            openPicker();
        }
    }
});

setInterval(requestRefresh, AUTO_REFRESH_MS);

draw();

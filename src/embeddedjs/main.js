// CarGlance for Hyundai, Kia & Genesis: vehicle dashboard (lock, charging,
// battery) for Pebble Time 2.
// All network access happens on the phone (src/pkjs/index.js); the watch only
// renders what it receives and asks for refreshes.
import Poco from "commodetto/Poco";
import Message from "pebble/message";
import Button from "pebble/button";
import Touch from "embedded:sensor/Touch/pebble";

const AUTO_REFRESH_MS = 10 * 60 * 1000;
const AGE_TICK_MS = 60 * 1000;
// The footer turns yellow once the car's data is older than this.
const STALE_AFTER_S = 60 * 60;

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

// Age of the car's data, e.g. "5 min ago". dataTime is in epoch seconds.
function formatAge(dataTime) {
    const min = Math.max(0, ((Date.now() / 1000 - dataTime) / 60) | 0);
    if (min < 1) return "just now";
    if (min < 60) return `${min} min ago`;
    const h = (min / 60) | 0;
    if (h < 24) return `${h} h ago`;
    const d = (h / 24) | 0;
    return d === 1 ? "1 day ago" : `${d} days ago`;
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

// Tap target of the refresh button in the header's top-left corner.
const REFRESH_BTN = { x: 0, y: 0, w: 44, h: 40 };

function hasRefreshButton() {
    return state.status === "ok" || state.status === "error";
}

function drawHeader(title) {
    render.fillRectangle(blue, 0, 0, render.width, 36);
    const withButton = hasRefreshButton();
    if (withButton) drawRefresh(18, 18, refreshing ? gray : white, blue);
    const maxW = render.width - (withButton ? 72 : 12);
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
    } else if (s.dataTime >= 0) {
        const stale = Date.now() / 1000 - s.dataTime > STALE_AFTER_S;
        centerText(`Car data: ${formatAge(s.dataTime)}`, labelFont, stale ? yellow : gray, 205);
    } else {
        centerText("Car data: age unknown", labelFont, gray, 205);
    }
}

function draw() {
    render.begin();
    render.fillRectangle(black, 0, 0, render.width, render.height);

    if (state.status === "ok") {
        drawHeader(state.name || "My car");
        drawDashboard();
    } else {
        drawHeader("CarGlance");
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

function requestRefresh() {
    refreshing = true;
    draw();
    if (!writable) {
        refreshPending = true;
        return;
    }
    refreshPending = false;
    try {
        message.write(new Map([["REFRESH", 1]]));
    } catch (e) {
        console.log("refresh write failed: " + e);
        refreshPending = true;
    }
}

function num(v, fallback) {
    return typeof v === "number" ? v : fallback;
}

const message = new Message({
    keys: ["REFRESH", "STATUS", "ERROR", "NAME", "LOCKED", "PLUGGED", "CHARGING",
        "CHARGE_STATUS", "SOC", "REMAIN_MIN", "DATA_TIME"],
    onReadable() {
        const msg = this.read();
        const status = msg.get("STATUS");
        if (status === "loading") {
            // Sent after the settings changed: drop data of the old account.
            refreshing = true;
            state = { status };
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
                dataTime: num(msg.get("DATA_TIME"), -1)
            };
        } else if (status) {
            refreshing = false;
            // Keep showing the last good data if a later refresh fails.
            if (state.status === "ok" && status === "error") {
                state.lastError = msg.get("ERROR");
            } else {
                state = { status, error: msg.get("ERROR") };
            }
        }
        draw();
    },
    onWritable() {
        writable = true;
        if (refreshPending) requestRefresh();
    },
    onSuspend() {
        writable = false;
    }
});

new Button({
    types: ["select"],
    onPush(down) {
        if (down) requestRefresh();
    }
});

function inRefreshButton(p) {
    return p.x >= REFRESH_BTN.x && p.x < REFRESH_BTN.x + REFRESH_BTN.w &&
        p.y >= REFRESH_BTN.y && p.y < REFRESH_BTN.y + REFRESH_BTN.h;
}

// A tap counts when it starts and ends inside the refresh button.
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
        const tapped = touchStart && inRefreshButton(touchStart) && inRefreshButton(touchLast);
        touchStart = touchLast = null;
        if (tapped && hasRefreshButton()) requestRefresh();
    }
});

setInterval(requestRefresh, AUTO_REFRESH_MS);
// Keep the data's age in the footer current between refreshes.
setInterval(() => {
    if (state.status === "ok" && !refreshing && !state.lastError) draw();
}, AGE_TICK_MS);

draw();

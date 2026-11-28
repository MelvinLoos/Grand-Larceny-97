import { audio } from './audio.js';
import { toggleEnterExitVehicle } from './combat.js';
import { buzz } from './haptics.js';
import { safeInsets } from './safe.js';
import { game, keys, player, stick } from './state.js';
import { cycleRadio, cycleWeapon, measureHud } from './ui.js';

const RADIUS = 56;
const DEADZONE = RADIUS * 0.18;
const FOLLOW = RADIUS * 1.4; // past this the stick origin drags along with the thumb
const MARGIN = RADIUS + 12;
const SIREN_HOLD_MS = 300;

let zone,
    base,
    knob,
    activeId = null,
    homeX = 0,
    homeY = 0;

// The base is drawn at the stick origin, nudged only as far as needed to stay fully on screen
function placeBase(x, y) {
    const s = safeInsets();
    const bx = Math.min(Math.max(x, RADIUS + 4 + s.l), window.innerWidth - RADIUS - 4 - s.r);
    const by = Math.min(Math.max(y, RADIUS + 4 + s.t), window.innerHeight - RADIUS - 4 - s.b);
    base.style.transform = `translate(${bx - RADIUS}px, ${by - RADIUS}px)`;
}

function computeHome() {
    const r = zone.getBoundingClientRect();
    if (!r.width) return; // controls hidden
    const s = safeInsets();
    homeX = Math.max(MARGIN, r.left + s.l + 24 + RADIUS + 8);
    homeY = r.bottom - s.b - 24 - RADIUS - 8;
    placeBase(homeX, homeY);
}

export function clearStick() {
    activeId = null;
    stick.active = false;
    stick.x = stick.y = stick.mag = 0;
    if (!zone) return;
    base.classList.remove('active');
    knob.style.transform = '';
    placeBase(homeX, homeY);
}

function setupStick() {
    zone = document.getElementById('stick-zone');
    base = document.getElementById('stick-base');
    knob = document.getElementById('stick-knob');
    // Origin of the thumb vector: exactly where the finger first lands (so a touch never starts deflected)
    let ox = 0,
        oy = 0;
    computeHome();
    window.addEventListener('resize', () => {
        if (activeId === null) computeHome();
    });

    zone.addEventListener('pointerdown', (e) => {
        if (activeId !== null) return;
        e.preventDefault();
        audio.init();
        activeId = e.pointerId;
        zone.setPointerCapture(e.pointerId);
        ox = e.clientX;
        oy = e.clientY;
        placeBase(ox, oy);
        base.classList.add('active');
        stick.active = true;
        move(e);
    });

    function move(e) {
        let dx = e.clientX - ox;
        let dy = e.clientY - oy;
        let d = Math.hypot(dx, dy);
        if (d > FOLLOW) {
            // Wide thumb sweep: slide the origin along so the stick re-centres under the thumb
            const k = (d - FOLLOW) / d;
            ox += dx * k;
            oy += dy * k;
            placeBase(ox, oy);
            dx = e.clientX - ox;
            dy = e.clientY - oy;
            d = FOLLOW;
        }
        const c = Math.min(d, RADIUS);
        const nx = d > 0 ? dx / d : 0;
        const ny = d > 0 ? dy / d : 0;
        knob.style.transform = `translate(${nx * c}px, ${ny * c}px)`;
        if (d < DEADZONE) {
            stick.mag = 0;
        } else {
            stick.mag = Math.min(1, (d - DEADZONE) / (RADIUS - DEADZONE));
            stick.x = nx;
            stick.y = ny;
        }
    }

    zone.addEventListener('pointermove', (e) => {
        if (e.pointerId === activeId) {
            e.preventDefault();
            move(e);
        }
    });
    const end = (e) => {
        if (e.pointerId === activeId) clearStick();
    };
    zone.addEventListener('pointerup', end);
    zone.addEventListener('pointercancel', end);
    zone.addEventListener('lostpointercapture', end);
}

function setupButtons() {
    const held = (btn, onDown, onUp) => {
        const down = (e) => {
            e.preventDefault();
            audio.init();
            btn.setPointerCapture(e.pointerId);
            btn.classList.add('pressed');
            buzz(8);
            onDown();
        };
        const up = () => {
            if (!btn.classList.contains('pressed')) return;
            btn.classList.remove('pressed');
            onUp();
        };
        btn.addEventListener('pointerdown', down);
        btn.addEventListener('pointerup', up);
        btn.addEventListener('pointercancel', up);
        btn.addEventListener('lostpointercapture', up);
    };

    document.querySelectorAll('#touch-controls [data-key]').forEach((btn) => {
        const k = btn.getAttribute('data-key');
        held(
            btn,
            () => (keys[k] = true),
            () => (keys[k] = false)
        );
    });
    held(document.getElementById('touch-car'), toggleEnterExitVehicle, () => {});
    held(document.getElementById('touch-radio'), cycleRadio, () => {});

    // HORN: honk on press in a civilian car. Cop and emergency cars wait to tell a tap (honk) from a
    // hold (>= SIREN_HOLD_MS toggles the siren; the button stays lit while it wails). On foot it is WEAPON.
    const horn = document.getElementById('touch-horn');
    let hornTimer = 0;
    let hornCar = null;
    let hornHeld = false;
    let hornT0 = 0;
    // One toggle per press: from the timer, or on release if the timer never ran (throttled / cancelled)
    const latchSiren = () => {
        if (hornHeld || !hornCar) return;
        hornHeld = true;
        clearTimeout(hornTimer);
        if (hornCar.hp > 0) hornCar.sirenOn = !hornCar.sirenOn;
        horn.classList.toggle('siren-on', !!hornCar.sirenOn);
        buzz(30);
    };
    held(
        horn,
        () => {
            const car = player.inCar;
            if (!car) return cycleWeapon();
            hornCar = car.spec.isPolice || car.spec.isEmergency ? car : null;
            hornHeld = false;
            if (!hornCar) return audio.horn(car);
            hornT0 = performance.now();
            clearTimeout(hornTimer);
            hornTimer = setTimeout(latchSiren, SIREN_HOLD_MS);
        },
        () => {
            clearTimeout(hornTimer);
            if (hornCar && performance.now() - hornT0 >= SIREN_HOLD_MS) latchSiren();
            else if (hornCar && !hornHeld) audio.horn(hornCar); // a tap honks and leaves a wailing siren alone
            hornCar = null;
        }
    );
}

// Controls show on touch-first devices and, on hybrids (touch laptops), from the first finger to the next mouse click
function setTouchUI(on) {
    if (document.body.classList.contains('touch-ui') === on) return;
    document.body.classList.toggle('touch-ui', on);
    game.touchMode = on;
    if (!on) clearStick();
    requestAnimationFrame(() => {
        if (on && activeId === null) computeHome();
        measureHud();
    });
}

export function setupTouch() {
    setupStick();
    setupButtons();
    const touchFirst = window.matchMedia('(pointer: coarse)').matches;
    setTouchUI(touchFirst);
    if (!touchFirst) {
        window.addEventListener(
            'pointerdown',
            (e) => {
                if (e.pointerType === 'touch') setTouchUI(true);
                else if (e.pointerType === 'mouse') setTouchUI(false);
            },
            true
        );
    }
    document.getElementById('touch-controls').addEventListener('contextmenu', (e) => e.preventDefault());
}

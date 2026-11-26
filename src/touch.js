import { audio } from './audio.js';
import { toggleEnterExitVehicle } from './combat.js';
import { buzz } from './haptics.js';
import { keys, player, stick } from './state.js';
import { cycleWeapon } from './ui.js';

const RADIUS = 56;
const DEADZONE = RADIUS * 0.18;
const MARGIN = RADIUS + 12;

let zone,
    base,
    knob,
    activeId = null,
    homeX = 0,
    homeY = 0;

function placeBase(x, y) {
    base.style.transform = `translate(${x - RADIUS}px, ${y - RADIUS}px)`;
}

function computeHome() {
    const r = zone.getBoundingClientRect();
    homeX = Math.max(MARGIN, r.left + 24 + RADIUS + 8);
    homeY = r.bottom - 24 - RADIUS - 8;
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
        const r = zone.getBoundingClientRect();
        ox = Math.min(Math.max(e.clientX, r.left + MARGIN), r.right - MARGIN);
        oy = Math.min(Math.max(e.clientY, r.top + MARGIN), r.bottom - MARGIN);
        placeBase(ox, oy);
        base.classList.add('active');
        stick.active = true;
        move(e);
    });

    function move(e) {
        const dx = e.clientX - ox;
        const dy = e.clientY - oy;
        const d = Math.hypot(dx, dy);
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
    held(
        document.getElementById('touch-horn'),
        () => {
            if (player.inCar) {
                if (player.inCar.spec.isPolice) player.inCar.sirenOn = !player.inCar.sirenOn;
                audio.horn(player.inCar);
            } else {
                cycleWeapon();
            }
        },
        () => {}
    );
}

export function setupTouch() {
    setupStick();
    setupButtons();
    document.getElementById('touch-controls').addEventListener('contextmenu', (e) => e.preventDefault());
}

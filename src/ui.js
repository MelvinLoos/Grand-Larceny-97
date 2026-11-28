import { audio } from './audio.js';
import { toggleEnterExitVehicle } from './combat.js';
import { CIVIL_STATIONS, FOOT_ZOOM, MIN_SPAN_FOOT, WEAPONS } from './config.js';
import { populateWorld } from './entities.js';
import { hideRadio, showBigBanner, showPager, showRadio, updateHUD } from './hud.js';
import { HAZARD } from './palette.js';
import { canvas, game, keys, mission, mouse, player, view } from './state.js';
import { closeCityMap, openCityMap } from './minimap.js';
import { clearStick, setupTouch } from './touch.js';

const manualEl = document.getElementById('manual');

// --- RESIZING & EVENT BINDINGS ---
export function handleResize() {
    const wrapper = document.getElementById('canvas-wrapper');
    view.w = wrapper.clientWidth;
    view.h = wrapper.clientHeight;
    view.dpr = Math.min(window.devicePixelRatio || 1, game.dprCap);
    canvas.width = Math.round(view.w * view.dpr);
    canvas.height = Math.round(view.h * view.dpr);
    // Phones see a wider slice of the street
    view.fit = Math.min(1, Math.max(0.7, Math.min(view.w, view.h) / 720));
    // Camera scale: phones see at least MIN_SPAN_FOOT world px along the short axis (zoom = FOOT_ZOOM * scale on foot)
    view.short = Math.min(view.w, view.h);
    view.scale = Math.min(1, view.short / (MIN_SPAN_FOOT * FOOT_ZOOM));
    measureHud();
}

// Frames the player in the strip the top HUD leaves clear (touch layouts only) and publishes the status box height to CSS
export function measureHud() {
    const st = document.querySelector('.st-status');
    const hud = document.getElementById('hud');
    if (!st || !hud) return;
    hud.style.setProperty('--status-h', st.offsetHeight + 'px');
    hud.style.setProperty(
        '--actions-h',
        (document.querySelector('#touch-controls .actions')?.offsetHeight || 0) + 'px'
    );
    if (!document.body.classList.contains('touch-ui')) {
        view.insetTop = view.shiftY = 0;
        return;
    }
    view.insetTop = st.offsetTop + st.offsetHeight;
    const portrait = view.h > view.w;
    const pad = portrait ? (document.querySelector('#touch-controls .actions')?.offsetHeight || 0) * 0.5 : 0;
    view.shiftY = Math.max(-0.1 * view.h, Math.min(0.1 * view.h, (view.insetTop - pad) / 2));
}

export function cycleWeapon(nextIdx = null) {
    audio.init();
    if (nextIdx !== null) {
        if (player.ammo[nextIdx] > 0) player.weaponIdx = nextIdx;
    } else {
        for (let i = 1; i <= WEAPONS.length; i++) {
            const cand = (player.weaponIdx + i) % WEAPONS.length;
            if (player.ammo[cand] > 0) {
                player.weaponIdx = cand;
                break;
            }
        }
    }
    updateHUD();
}

// R: next station in a civilian car; cop cars and the tank only flip their own channel on and off
export function cycleRadio() {
    const car = player.inCar;
    if (!car) return;
    const own = car.spec.isTank ? 'army' : 'nbpd';
    const list = car.spec.isPolice || car.spec.isTank ? [own, 'off'] : CIVIL_STATIONS;
    car.radioStation = list[(list.indexOf(car.radioStation) + 1) % list.length];
    audio.tuneTo(car.radioStation);
    showRadio(car.radioStation);
}

export function clearInputs() {
    for (const k in keys) keys[k] = false;
    mouse.down = false;
    clearStick();
}

export function startGame() {
    if (game.state !== 'title') return;
    audio.init();
    if (
        window.matchMedia('(pointer: coarse)').matches &&
        document.fullscreenEnabled &&
        !document.fullscreenElement &&
        !window.matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches
    ) {
        // No orientation lock: portrait is fully playable; the one-time rotate chip suggests landscape
        document.documentElement.requestFullscreen({ navigationUI: 'hide' }).catch(() => {});
    }
    game.state = 'play';
    player.currentDistrict = -1;
    game.districtCooldown = 0;
    const box = document.getElementById('box');
    box.classList.add('opening');
    setTimeout(() => {
        box.hidden = true;
        document.getElementById('hud').classList.add('on');
        updateHUD();
        showPager('PAYPHONES ARE RINGING. FOLLOW THE CYAN ARROW TO A PHONE BOOTH!');
        setTimeout(showRotateHint, 7000);
    }, 720);
}

// Once per device: portrait phones are playable but landscape shows far more street
const ROTATE_HINT_KEY = 'gl97-rotate-hint';
function showRotateHint() {
    const el = document.getElementById('rotate-hint');
    if (game.state !== 'play' || !game.touchMode || window.innerHeight <= window.innerWidth) return;
    try {
        if (localStorage.getItem(ROTATE_HINT_KEY)) return;
        localStorage.setItem(ROTATE_HINT_KEY, '1');
    } catch {
        // storage blocked: still show it this session
    }
    el.hidden = false;
    setTimeout(() => (el.hidden = true), 9000);
}

export function openManual() {
    if (game.state === 'paused') return;
    game.manualFrom = game.state;
    if (game.state === 'play') game.state = 'paused';
    clearInputs();
    document.getElementById('resume-lbl').textContent =
        game.manualFrom === 'title' ? 'Back to the box' : 'Back to the streets';
    document.getElementById('btn-restart').hidden = game.manualFrom === 'title';
    manualEl.hidden = false;
    document.getElementById('btn-resume').focus();
}

export function closeManual() {
    manualEl.hidden = true;
    if (game.manualFrom === 'play') {
        game.state = 'play';
        game.lastFrameTime = performance.now();
    } else {
        document.getElementById('btn-start-game').focus();
    }
}

export function toggleSound() {
    const on = audio.toggle();
    const hudBtn = document.getElementById('btn-sound');
    hudBtn.setAttribute('aria-pressed', on);
    hudBtn.querySelector('use').setAttribute('href', on ? '#i-sound' : '#i-mute');
    const mBtn = document.getElementById('btn-sound-manual');
    mBtn.setAttribute('aria-pressed', on);
    mBtn.querySelector('use').setAttribute('href', on ? '#i-sound' : '#i-mute');
    mBtn.querySelector('span').textContent = on ? 'Sound on' : 'Sound off';
}

export function setupEvents() {
    // 3x phones gain nothing from a 3x canvas of chunky pixels: start at 1.5x (adaptQuality can still step down to 1x)
    if (window.matchMedia('(any-pointer: coarse)').matches) game.dprCap = 1.5;
    window.addEventListener('resize', handleResize);
    const ro = new ResizeObserver(measureHud);
    ro.observe(document.querySelector('.st-status'));
    ro.observe(document.querySelector('#touch-controls .actions'));

    window.addEventListener('keydown', (e) => {
        audio.init();
        if (e.code === 'KeyN') {
            if (!e.repeat) toggleSound();
            return;
        }
        if (!manualEl.hidden) {
            if (e.code === 'Escape' || e.code === 'KeyP') {
                e.preventDefault();
                closeManual();
            }
            return;
        }
        if (game.mapOpen) {
            if (e.code === 'Escape' || e.code === 'KeyM' || e.code === 'KeyP') {
                e.preventDefault();
                closeCityMap();
            }
            return;
        }
        if (game.state === 'title') {
            if ((e.code === 'Enter' || e.code === 'Space') && !e.repeat) {
                e.preventDefault();
                startGame();
            }
            return;
        }
        if (e.code === 'KeyM') {
            e.preventDefault();
            clearInputs();
            openCityMap();
            return;
        }
        if (e.code === 'Escape' || e.code === 'KeyP') {
            e.preventDefault();
            openManual();
            return;
        }
        keys[e.code] = true;

        if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) {
            e.preventDefault();
        }

        if (!e.repeat) {
            if (e.code === 'Enter' || e.code === 'KeyF' || e.code === 'KeyE') {
                toggleEnterExitVehicle();
            } else if (e.code === 'KeyQ') {
                cycleWeapon();
            } else if (e.code === 'Digit1') cycleWeapon(0);
            else if (e.code === 'Digit2') cycleWeapon(1);
            else if (e.code === 'Digit3') cycleWeapon(2);
            else if (e.code === 'Digit4') cycleWeapon(3);
            else if (e.code === 'KeyR' && player.inCar) cycleRadio();
            else if (e.code === 'KeyH' && player.inCar) {
                if (player.inCar.spec.isPolice || player.inCar.spec.isEmergency) {
                    player.inCar.sirenOn = !player.inCar.sirenOn;
                }
                audio.horn(player.inCar);
            }
        }
    });

    window.addEventListener('keyup', (e) => {
        keys[e.code] = false;
    });

    canvas.addEventListener('mousemove', (e) => {
        const rect = canvas.getBoundingClientRect();
        mouse.x = e.clientX - rect.left;
        mouse.y = e.clientY - rect.top;
        mouse.movedAt = performance.now();
    });

    canvas.addEventListener('mousedown', (e) => {
        if (e.button === 0) {
            audio.init();
            const rect = canvas.getBoundingClientRect();
            mouse.x = e.clientX - rect.left;
            mouse.y = e.clientY - rect.top;
            mouse.down = true;
            mouse.movedAt = performance.now();
        }
    });

    window.addEventListener('mouseup', () => {
        mouse.down = false;
    });

    document.getElementById('radio').addEventListener('click', cycleRadio); // tap the readout on touch
    document.getElementById('btn-weapon').addEventListener('click', () => cycleWeapon());
    document.getElementById('btn-sound').addEventListener('click', toggleSound);
    document.getElementById('btn-sound-manual').addEventListener('click', toggleSound);
    document.getElementById('btn-help').addEventListener('click', openManual);
    document.getElementById('radar').addEventListener('click', () => {
        clearInputs();
        openCityMap();
    });
    document.getElementById('btn-close-map').addEventListener('click', closeCityMap);
    document.getElementById('btn-map-x').addEventListener('click', closeCityMap);
    document.getElementById('btn-map').addEventListener('click', () => {
        clearInputs();
        openCityMap();
    });
    // Tap the dark backdrop (anywhere but the map, key and buttons) to close the map
    document.getElementById('map-overlay').addEventListener('click', (e) => {
        if (e.target.id === 'map-overlay' || e.target.classList.contains('map-wrap')) closeCityMap();
    });
    document.getElementById('btn-rotate-x').addEventListener('click', () => {
        document.getElementById('rotate-hint').hidden = true;
    });
    document.getElementById('btn-open-manual').addEventListener('click', openManual);
    document.getElementById('btn-resume').addEventListener('click', closeManual);
    document.getElementById('btn-start-game').addEventListener('click', startGame);
    document.getElementById('btn-restart').addEventListener('click', () => {
        audio.init();
        player.score = 0;
        player.multiplier = 1;
        mission.active = false;
        populateWorld();
        hideRadio();
        game.lastWantedLevel = -1;
        closeManual();
        updateHUD();
        showBigBanner('CITY RESET', 'WELCOME BACK TO 1997!', HAZARD);
    });
    document.addEventListener('visibilitychange', () => {
        if (document.hidden && game.state === 'play') openManual();
    });
    if (window.matchMedia('(pointer: coarse)').matches)
        document.getElementById('start-hint').textContent = 'TAP TO PLAY';

    setupTouch();
    handleResize(); // DPR cap and touch-ui layout are known now
}

import { audio } from './audio.js';
import { toggleEnterExitVehicle } from './combat.js';
import { WEAPONS } from './config.js';
import { populateWorld } from './entities.js';
import { hideRadio, showBigBanner, showPager, updateHUD } from './hud.js';
import { HAZARD } from './palette.js';
import { canvas, game, keys, mission, mouse, player, view } from './state.js';

const manualEl = document.getElementById('manual');

// --- RESIZING & EVENT BINDINGS ---
export function handleResize() {
    const wrapper = document.getElementById('canvas-wrapper');
    view.w = wrapper.clientWidth;
    view.h = wrapper.clientHeight;
    canvas.width = view.w;
    canvas.height = view.h;
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

export function clearInputs() {
    for (const k in keys) keys[k] = false;
    mouse.down = false;
}

export function startGame() {
    if (game.state !== 'title') return;
    audio.init();
    game.state = 'play';
    game.lastDistrict = '';
    const box = document.getElementById('box');
    box.classList.add('opening');
    setTimeout(() => {
        box.hidden = true;
        document.getElementById('hud').classList.add('on');
        updateHUD();
        showPager('PAYPHONES ARE RINGING. FOLLOW THE YELLOW ARROW!');
    }, 720);
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
    window.addEventListener('resize', handleResize);

    window.addEventListener('keydown', (e) => {
        audio.init();
        if (!manualEl.hidden) {
            if (e.code === 'Escape' || e.code === 'KeyP') {
                e.preventDefault();
                closeManual();
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
            else if (e.code === 'KeyH' && player.inCar) {
                if (player.inCar.spec.isPolice) {
                    player.inCar.sirenOn = !player.inCar.sirenOn;
                }
                audio.horn(player.inCar.spec.isPolice);
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
    });

    canvas.addEventListener('mousedown', (e) => {
        if (e.button === 0) {
            audio.init();
            const rect = canvas.getBoundingClientRect();
            mouse.x = e.clientX - rect.left;
            mouse.y = e.clientY - rect.top;
            mouse.down = true;
        }
    });

    window.addEventListener('mouseup', () => {
        mouse.down = false;
    });

    document.getElementById('btn-weapon').addEventListener('click', () => cycleWeapon());
    document.getElementById('btn-sound').addEventListener('click', toggleSound);
    document.getElementById('btn-sound-manual').addEventListener('click', toggleSound);
    document.getElementById('btn-help').addEventListener('click', openManual);
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

    // Mobile Touch Pad Controls
    document.querySelectorAll('[data-key]').forEach((btn) => {
        const k = btn.getAttribute('data-key');
        const press = (ev) => {
            ev.preventDefault();
            audio.init();
            keys[k] = true;
            btn.classList.add('pressed');
        };
        const release = (ev) => {
            ev.preventDefault();
            keys[k] = false;
            btn.classList.remove('pressed');
        };
        btn.addEventListener('touchstart', press, { passive: false });
        btn.addEventListener('touchend', release, { passive: false });
        btn.addEventListener('touchcancel', release, { passive: false });
        btn.addEventListener('mousedown', press);
        btn.addEventListener('mouseup', release);
        btn.addEventListener('mouseleave', release);
    });

    document.getElementById('touch-car').addEventListener('click', () => toggleEnterExitVehicle());
    document.getElementById('touch-horn').addEventListener('click', () => {
        if (player.inCar) {
            if (player.inCar.spec.isPolice) player.inCar.sirenOn = !player.inCar.sirenOn;
            audio.horn(player.inCar.spec.isPolice);
        } else {
            cycleWeapon();
        }
    });
}

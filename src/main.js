import './styles/base.css';
import './styles/box.css';
import './styles/hud.css';
import './styles/touch.css';
import './styles/manual.css';
import './styles/responsive.css';
import * as city from './city.js';
import * as river from './river.js';
import * as emergency from './emergency.js';
import * as heat from './heat.js';
import * as lawforce from './lawforce.js';
import * as stunts from './stunts.js';
import { audio } from './audio.js';
import * as combat from './combat.js';
import { LANDMARKS, buildCity } from './city.js';
import { populateWorld } from './entities.js';
import { bakeFoliage, plantFoliage } from './foliage.js';
import { bakeVehicles } from './vehicles.js';
import { showPager, updateHUD } from './hud.js';
import { render } from './render.js';
import * as state from './state.js';
import { camera, game, player, view } from './state.js';
import { handleResize, setupEvents } from './ui.js';
import { update } from './update.js';

const boxWindow = document.getElementById('box-window');

console.info(`Grand Larceny '97 build ${__BUILD__}`);

// --- UPDATES: look for a new release on focus and every 15 min. The new service worker announces
// itself with 'update-ready'; we acknowledge (so its 3s fallback reload stands down) and reload at a
// safe moment: title, paused / manual / map, dead, or a hidden tab. Mid-run we only show a pager notice ---
let updatePending = false;
const safeToReload = () => game.state !== 'play' || player.deadTimer > 0 || document.hidden;
function reloadIfReady() {
    if (updatePending && safeToReload()) location.reload();
}
if ('serviceWorker' in navigator) {
    const checkForUpdate = () =>
        navigator.serviceWorker
            .getRegistration()
            .then((reg) => reg?.update())
            .catch(() => {});
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') checkForUpdate();
        else reloadIfReady();
    });
    setInterval(checkForUpdate, 15 * 60 * 1000);
    navigator.serviceWorker.addEventListener('message', (e) => {
        if (e.data?.type !== 'update-ready') return;
        e.source?.postMessage({ type: 'update-ack' });
        if (updatePending) return;
        updatePending = true;
        if (safeToReload()) return reloadIfReady();
        showPager('NEW BUILD READY — PAUSE TO UPDATE');
    });
}

// --- AUTO QUALITY: step the render scale down if frames stay slow ---
function adaptQuality(raw, dt) {
    if (game.state !== 'play' || game.dprCap <= 1 || !(raw > 0) || raw > 100) return;
    game.frameEma += (raw - game.frameEma) * 0.05;
    game.slowTime = game.frameEma > 24 ? game.slowTime + dt : 0;
    if (game.slowTime > 3) {
        game.dprCap = game.dprCap > 1.5 ? 1.5 : 1;
        game.slowTime = 0;
        game.frameEma = 16;
        handleResize();
    }
}

// --- GAME LOOP ---
function gameLoop(timestamp) {
    const raw = timestamp - game.lastFrameTime;
    const dt = Math.min(0.05, raw / 1000 || 0.016);
    game.lastFrameTime = timestamp;
    adaptQuality(raw, dt);

    reloadIfReady();
    audio.setActive(game.state !== 'paused'); // paused / map / hidden tab: suspend every loop and the radio clock
    if (game.state !== 'paused') update(dt);
    if (game.state === 'title') {
        // Attract mode: the camera drifts over Neon Bay behind the box window
        const t = timestamp * 0.001;
        const wr = boxWindow.getBoundingClientRect();
        game.attractWindow = { x: wr.left + wr.width / 2, y: wr.top + wr.height / 2 };
        camera.zoom = (view.w < 600 ? 0.36 : 0.46) * Math.max(view.fit, 0.85);
        // Figure-eight that starts over Central Park, then sweeps the grid and the coast
        camera.x =
            LANDMARKS.parkCenter.x + Math.sin(t * 0.05) * 1900 - (game.attractWindow.x - view.w / 2) / camera.zoom;
        camera.y = LANDMARKS.parkCenter.y + Math.sin(t * 0.1) * 700 - (game.attractWindow.y - view.h / 2) / camera.zoom;
    }
    render();
    requestAnimationFrame(gameLoop);
}

// --- BOOTSTRAP (module scripts run after the document is parsed) ---
async function init() {
    handleResize();
    await Promise.all([bakeFoliage(), bakeVehicles()]);
    buildCity();
    populateWorld();
    plantFoliage();
    setupEvents();
    updateHUD();
    document.getElementById('btn-start-game').focus({ preventScroll: true });
    game.lastFrameTime = performance.now();
    requestAnimationFrame(gameLoop);
}

init();

// Dev-only console hook for poking at the world (stripped from production builds)
if (import.meta.env.DEV) {
    window.__gl = {
        city,
        river,
        stunts,
        state,
        LANDMARKS,
        audio,
        heat,
        lawforce,
        emergency,
        // Scripted poking for playtests
        setWanted(n) {
            state.player.wanted = n;
            state.player.unseenTimer = 0;
            updateHUD();
        },
        popTires: (n = 2) => state.player.inCar && lawforce.popTires(state.player.inCar, n),
        roadblock: () => lawforce.spawnRoadblock(true),
        wreckNear() {
            const { cars, player } = state;
            const c = cars
                .filter((o) => o.hp > 0 && o !== player.inCar && o.typeKey !== 'tank')
                .sort(
                    (a, b) => Math.hypot(a.x - player.x, a.y - player.y) - Math.hypot(b.x - player.x, b.y - player.y)
                )[0];
            if (c) combat.destroyCar(c, false);
            return c?.typeKey;
        },
        killPeds(n = 2) {
            const { peds, player } = state;
            peds.filter((p) => p.role === 'civilian' && p.hp > 0)
                .sort((a, b) => Math.hypot(a.x - player.x, a.y - player.y) - Math.hypot(b.x - player.x, b.y - player.y))
                .slice(0, n)
                .forEach((p) => combat.damagePed(p, 999, false));
        }
    };
}

import './styles/base.css';
import './styles/box.css';
import './styles/hud.css';
import './styles/touch.css';
import './styles/manual.css';
import './styles/responsive.css';
import * as city from './city.js';
import * as river from './river.js';
import * as stunts from './stunts.js';
import { audio } from './audio.js';
import { LANDMARKS, buildCity } from './city.js';
import { populateWorld } from './entities.js';
import { bakeFoliage, plantFoliage } from './foliage.js';
import { bakeVehicles } from './vehicles.js';
import { updateHUD } from './hud.js';
import { render } from './render.js';
import * as state from './state.js';
import { camera, game, view } from './state.js';
import { handleResize, setupEvents } from './ui.js';
import { update } from './update.js';

const boxWindow = document.getElementById('box-window');

// --- UPDATES: look for a new release on focus and every 15 min; the new
// service worker then reloads the tab (public/sw-reload.js) ---
if ('serviceWorker' in navigator) {
    const checkForUpdate = () =>
        navigator.serviceWorker
            .getRegistration()
            .then((reg) => reg?.update())
            .catch(() => {});
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') checkForUpdate();
    });
    setInterval(checkForUpdate, 15 * 60 * 1000);
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
if (import.meta.env.DEV) window.__gl = { city, river, stunts, state, LANDMARKS, audio };

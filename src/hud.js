import { audio } from './audio.js';
import { STATIONS, WEAPONS, flatCount } from './config.js';
import { DISTRICTS, getDistrictAt } from './districts.js';
import { HAZARD } from './palette.js';
import { floatingTexts, game, mission, player } from './state.js';

export function addScore(pts, x, y, customLabel = null) {
    const total = Math.round(pts * player.multiplier);
    player.score += total;
    if (x !== undefined && y !== undefined) {
        spawnFloatingText(
            customLabel ? `${customLabel} +$${total.toLocaleString('en-US')}` : `+$${total.toLocaleString('en-US')}`,
            x,
            y,
            HAZARD
        );
    }
    updateHUD();
}

export function spawnFloatingText(text, x, y, color = '#ffd400', scale = 1) {
    floatingTexts.push({
        text,
        x,
        y,
        vy: -42,
        life: 1.35,
        maxLife: 1.35,
        color,
        scale
    });
}

export function showPager(msg) {
    const box = document.getElementById('pager-box');
    document.getElementById('pager-message').textContent = msg;
    box.classList.remove('show');
    void box.offsetWidth;
    box.classList.add('show');
    document.getElementById('hud').classList.add('paging');
    audio.pager();
    if (game.pagerTimeout) clearTimeout(game.pagerTimeout);
    game.pagerTimeout = setTimeout(() => {
        box.classList.remove('show');
        document.getElementById('hud').classList.remove('paging');
    }, 5200);
}

export function showBigBanner(title, sub = '', color = '#ffd400', variant = '') {
    const wrap = document.getElementById('big-banner');
    wrap.classList.toggle('job', variant === 'job');
    const titleEl = document.getElementById('big-banner-title');
    const subEl = document.getElementById('big-banner-sub');
    titleEl.textContent = title;
    titleEl.style.color = color;
    subEl.textContent = sub;
    subEl.hidden = !sub;
    wrap.classList.remove('show');
    void wrap.offsetWidth;
    wrap.classList.add('show');
}

export function showRadio(stationId) {
    const el = document.getElementById('radio');
    const r = STATIONS[stationId] || STATIONS.off;
    document.getElementById('radio-freq').innerHTML = r.band ? `${r.freq}<small>${r.band}</small>` : r.freq;
    document.getElementById('radio-name').textContent = r.name;
    document.getElementById('radio-tag').textContent = r.tag;
    el.classList.remove('mini');
    el.classList.add('show');
    document.getElementById('hud').classList.add('radio-on');
    if (game.radioTimer) clearTimeout(game.radioTimer);
    game.radioTimer = setTimeout(() => {
        el.classList.add('mini');
        document.getElementById('hud').classList.remove('radio-on');
    }, 2500);
}
export function hideRadio() {
    if (game.radioTimer) clearTimeout(game.radioTimer);
    document.getElementById('radio').classList.remove('show');
    document.getElementById('hud').classList.remove('radio-on');
}

// 1997-style "you are now in" banner: slides in bottom-right for 2.5s, at most one per 3s
export function updateDistrictName(dt) {
    game.districtCooldown = Math.max(0, game.districtCooldown - dt);
    const idx = getDistrictAt(player.x, player.y);
    if (idx === player.currentDistrict || game.districtCooldown > 0) return;
    player.currentDistrict = idx;
    game.districtCooldown = 3;
    const el = document.getElementById('district-label');
    el.textContent = DISTRICTS[idx].name;
    el.classList.add('show');
    document.getElementById('hud').classList.add('district-on');
    if (game.districtTimer) clearTimeout(game.districtTimer);
    game.districtTimer = setTimeout(() => {
        el.classList.remove('show');
        document.getElementById('hud').classList.remove('district-on');
    }, 2500);
}

// Restarts a one-shot CSS animation class
function retrigger(el, cls) {
    el.classList.remove(cls);
    void el.offsetWidth;
    el.classList.add(cls);
}

// Single detector for every HP source (bullets, cars, blasts, drowning): flash the screen edge,
// bump the health meter and pop the number. Small trickles accumulate until they reach 2.
export function trackHpLoss() {
    const lost = player.hpSeen - player.hp;
    if (lost < 0) player.hpSeen = player.hp; // healed or respawned
    if (lost < 2) return;
    player.hpSeen = player.hp;
    const flash = document.getElementById('damage-flash');
    flash.style.setProperty('--a', Math.min(0.55, Math.max(0.18, lost / 40)).toFixed(2));
    retrigger(flash, 'hit');
    retrigger(document.getElementById('hud-health-bar').closest('.meter-row'), 'hit');
    spawnFloatingText('-' + Math.round(lost), player.x, player.y - 34, '#ff3b30', 0.9);
}

export function updateHUD() {
    const $ = (id) => document.getElementById(id);
    $('hud-score').textContent = '$' + player.score.toLocaleString('en-US', { minimumIntegerDigits: 7 });
    $('hud-multiplier').textContent = '×' + player.multiplier;
    const hp = Math.max(0, Math.round(player.hp));
    $('hud-health-bar').style.width = `${hp}%`;
    $('hud-health-bar').parentElement.setAttribute('aria-valuenow', hp);
    $('hud-armor-bar').style.width = `${Math.max(0, player.armor)}%`;

    const w = WEAPONS[player.weaponIdx];
    $('hud-weapon-icon').setAttribute('href', '#' + w.icon);
    $('hud-weapon-name').textContent = w.name;
    $('hud-weapon-ammo').textContent = player.ammo[player.weaponIdx] === Infinity ? '∞' : player.ammo[player.weaponIdx];

    const level = Math.floor(player.wanted);
    if (level !== game.lastWantedLevel) {
        game.lastWantedLevel = level;
        audio.dispatch();
        const el = $('hud-wanted');
        let html = '';
        for (let i = 0; i < 4; i++) {
            html += `<svg class="icon solid${i < level ? ' lit' : ''}" aria-hidden="true"><use href="#i-badge"/></svg>`;
        }
        el.innerHTML = html;
        el.classList.toggle('hot', level >= 3);
        el.setAttribute('aria-label', `Wanted level ${level} of 4`);
    }

    $('hud-wanted').classList.toggle('probation', player.probation > 0);
    const car = player.inCar;
    const flats = car ? flatCount(car) : 0;
    $('hud-tires').hidden = flats === 0;
    if (flats) $('hud-tires-lbl').textContent = flats > 1 ? `FLAT TIRES ×${flats}` : 'FLAT TIRE';
    $('hud-bomb').hidden = !(car && car.hasBomb);
    $('hud-bomb').classList.toggle('armed', !!(car && car.bombArmed));
    $('touch-bomb').hidden = !(car && car.hasBomb && !car.bombArmed);
    $('hud-mission-timer').hidden = !mission.active;
    if (mission.active) $('mission-text').textContent = mission.title;
    $('hud-mission-timer').classList.toggle('kill', mission.kind === 'kill');

    $('touch-controls').classList.toggle('on-foot', !player.inCar);
    $('touch-car-lbl').textContent = player.inCar ? 'EXIT' : 'CAR';
    $('touch-horn-lbl').textContent = player.inCar ? 'HORN' : 'WEAPON';
    $('touch-horn-icon').setAttribute('href', player.inCar ? '#i-horn' : '#' + w.icon);
}

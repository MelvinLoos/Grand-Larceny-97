import { audio } from './audio.js';
import { WEAPONS } from './config.js';
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
    audio.playTone(2400, 2400, 0.06, 'square', 0.035);
    setTimeout(() => audio.playTone(2400, 2400, 0.06, 'square', 0.035), 120);
    if (game.pagerTimeout) clearTimeout(game.pagerTimeout);
    game.pagerTimeout = setTimeout(() => {
        box.classList.remove('show');
        document.getElementById('hud').classList.remove('paging');
    }, 5200);
}

export function showBigBanner(title, sub = '', color = '#ffd400') {
    const wrap = document.getElementById('big-banner');
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

export function showRadio(spec) {
    const el = document.getElementById('radio');
    const r = spec.radio;
    document.getElementById('radio-freq').innerHTML = `${r.freq}<small>${r.band}</small>`;
    document.getElementById('radio-name').textContent = r.name;
    document.getElementById('radio-tag').textContent = r.tag;
    el.classList.remove('mini');
    el.classList.add('show');
    document.getElementById('hud').classList.add('radio-on');
    if (game.radioTimer) clearTimeout(game.radioTimer);
    game.radioTimer = setTimeout(() => {
        el.classList.add('mini');
        document.getElementById('hud').classList.remove('radio-on');
    }, 3400);
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
    $('hud-bomb').hidden = !(car && car.hasBomb);
    $('hud-bomb').classList.toggle('armed', !!(car && car.bombArmed));
    $('touch-bomb').hidden = !(car && car.hasBomb && !car.bombArmed);
    $('hud-mission-timer').hidden = !mission.active;
    if (mission.active) $('mission-text').textContent = mission.title;

    $('touch-controls').classList.toggle('on-foot', !player.inCar);
    $('touch-car-lbl').textContent = player.inCar ? 'EXIT' : 'CAR';
    $('touch-horn-lbl').textContent = player.inCar ? 'HORN' : 'WEAPON';
    $('touch-horn-icon').setAttribute('href', player.inCar ? '#i-horn' : '#' + w.icon);
}

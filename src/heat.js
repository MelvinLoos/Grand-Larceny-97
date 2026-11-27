import { audio } from './audio.js';
import { hasLineOfSight, pickRoadSpawnNear, tileAtWorld } from './city.js';
import { T_ROAD_H, T_ROAD_V, T_ROAD_X, T_PAVEMENT, WANTED_TIERS, isLaw } from './config.js';
import { addCar, createCar } from './entities.js';
import { showPager, updateHUD } from './hud.js';
import { cars, heat, mission, peds, player, roadblocks } from './state.js';

// --- CRIME TABLE ---
// minor: only counts if a cop can see it (or a civilian rings 911, p911 chance, never in back-alleys)
// db: debounce seconds per category so one collision cannot stack heat every frame
const CRIMES = {
    bump: { amt: 0.12, db: 1.5, minor: true, p911: 0.25 },
    prop: { amt: 0.1, db: 2, minor: true, p911: 0.25 },
    shots: { amt: 0.15, db: 3, minor: true, p911: 0 },
    jack: { amt: 0.45, db: 0.5, minor: true, p911: 0.25 },
    assault: { amt: 0.35, db: 0.6, minor: true, p911: 0.25 },
    wreck: { amt: 0.7, db: 0.5, minor: true, p911: 0.5 },
    copBump: { amt: 0.35, db: 2 },
    copJack: { amt: 1.2, db: 1 },
    copKill: { amt: 1.1, db: 0, slaughter: true },
    copWreck: { amt: 1.5, db: 0, slaughter: true },
    scripted: { amt: 0, db: 0 }
};

const WITNESS_RANGE = 520;
const SIGHT_RANGE = 600;

// Mission heat curve: early missions ease the player in
export function missionCurve() {
    if (!mission.active) return { mult: 1, cap: 4 };
    const n = mission.completedCount;
    if (n === 0) return { mult: 0.5, cap: 2 };
    if (n === 1) return { mult: 0.75, cap: 3 };
    return { mult: Math.min(1.25, 1 + 0.08 * (n - 2)), cap: 4 };
}

// Is any living cop / cruiser (with a driver) within `range` of (x, y) with a clear line?
function lawNear(x, y, range) {
    for (const p of peds) {
        if (p.hp <= 0 || !isLaw(p)) continue;
        if (Math.hypot(p.x - x, p.y - y) < range && hasLineOfSight(p.x, p.y, x, y)) return true;
    }
    for (const c of cars) {
        if (c.hp <= 0 || !c.spec.isPolice || !c.driver || c === player.inCar) continue;
        if (Math.hypot(c.x - x, c.y - y) < range && hasLineOfSight(c.x, c.y, x, y)) return true;
    }
    return false;
}

function onAvenue(x, y) {
    const t = tileAtWorld(x, y);
    return t === T_ROAD_H || t === T_ROAD_V || t === T_ROAD_X || t === T_PAVEMENT;
}

// --- WANTED SYSTEM ---
// cat: key of CRIMES; opts: { x, y } where it happened, { amount } for scripted mission heat
export function addCrime(cat, opts = {}) {
    const def = CRIMES[cat];
    if (!def || player.deadTimer > 0) return;
    if (heat.cooldowns[cat] > 0) return;
    heat.cooldowns[cat] = def.db;

    const x = opts.x ?? player.x;
    const y = opts.y ?? player.y;
    if (def.minor && !lawNear(x, y, WITNESS_RANGE) && !(onAvenue(x, y) && Math.random() < def.p911)) return;

    const curve = missionCurve();
    let amount = cat === 'scripted' ? opts.amount : def.amt * curve.mult;

    if (player.probation > 0) {
        // Crime during probation: the cops get their heat back, plus this crime
        amount += player.probationWanted;
        player.probation = 0;
        player.probationWanted = 0;
        player.wanted = 0;
    }
    const ceil = def.slaughter ? 4 : Math.min(4, curve.cap + 0.99);
    player.wanted = Math.max(player.wanted, Math.min(ceil, player.wanted + amount));
    player.unseenTimer = 0;
    audio.dispatch();
    updateHUD();
}

// Mission clear / busted / wasted: heat goes to zero, every pursuer stands down, roadblocks dissolve
export function releasePursuer(c) {
    c.pursuit = false;
    if (c.aiMode === 'police') c.aiMode = 'traffic';
    c.sirenOn = false;
    c.dismount = null; // a half-finished unload is abandoned with the chase
    c.pinT = 0;
    if (!c.stranded) c.handbrake = false;
}

export function clearHeat() {
    player.wanted = 0;
    player.probation = 0;
    player.probationWanted = 0;
    player.unseenTimer = 0;
    heat.cooling = false;
    heat.dispatchCd = 0;
    heat.fillTimer = 0;
    for (const c of cars) {
        if (c.pursuit) releasePursuer(c);
        if (c.roadblock) {
            c.roadblock = null;
            c.lightsOnly = false;
            c.sirenOn = false;
        }
    }
    for (const rb of roadblocks) rb.expire = true;
    for (const p of peds) delete p.cover;
    document.getElementById('hud-wanted')?.classList.remove('cooling');
    updateHUD();
}

// --- DISPATCH: pursuit caps, replacements, unit mix ---
let roleFlip = false;
export function startPursuit(c) {
    c.pursuit = true;
    c.aiMode = 'police';
    c.sirenOn = true;
    roleFlip = !roleFlip;
    c.pursuitRole = roleFlip ? 'cutoff' : 'chase';
}

function pickUnit(level, units) {
    if (level >= 4) {
        if (!units.some((c) => c.spec.isSwat)) return 'swat_van';
        if (!units.some((c) => c.spec.isFed)) return 'fbi_car';
    }
    return 'police';
}

function fillSlot(level, units) {
    const type = pickUnit(level, units);
    if (type === 'police') {
        // Prefer pulling in a cruiser already patrolling nearby over conjuring a new one
        for (const c of cars) {
            if (c.typeKey !== 'police' || c.pursuit || c.roadblock || !c.driver || c.hp <= 0) continue;
            if (c.aiMode !== 'traffic' || c.sink > 0) continue;
            if (Math.hypot(c.x - player.x, c.y - player.y) < 900 && hasLineOfSight(c.x, c.y, player.x, player.y)) {
                startPursuit(c);
                return true;
            }
        }
    }
    const spot = pickRoadSpawnNear(player.x, player.y, 580, 920);
    if (!spot) return false;
    const c = createCar(type, spot.x, spot.y, spot.angle, 'police');
    startPursuit(c);
    addCar(c);
    return true;
}

function updatePursuit(dt, level) {
    const tier = WANTED_TIERS[level];
    const units = [];
    for (const c of cars) {
        if (!c.pursuit) continue;
        const lost =
            level === 0 ||
            c.hp <= 0 ||
            c.sink > 0 ||
            c.sunk ||
            c.aiMode === 'player' ||
            !c.driver ||
            Math.hypot(c.x - player.x, c.y - player.y) > 1700;
        if (lost) {
            releasePursuer(c);
            if (level > 0) heat.dispatchCd = Math.max(heat.dispatchCd, tier.replace);
        } else units.push(c);
    }
    if (level === 0) return;
    // Wanted level dropped: stand down the farthest surplus units
    if (units.length > tier.cap) {
        units.sort((a, b) => Math.hypot(b.x - player.x, b.y - player.y) - Math.hypot(a.x - player.x, a.y - player.y));
        while (units.length > tier.cap) releasePursuer(units.shift());
    }
    heat.fillTimer = Math.max(0, heat.fillTimer - dt);
    if (units.length < tier.cap && heat.dispatchCd <= 0 && heat.fillTimer <= 0) {
        if (fillSlot(level, units)) heat.fillTimer = 3;
    }
}

// Room for another beat cop on foot near the player at this level?
export function footCopRoom(level) {
    const max = WANTED_TIERS[level].foot;
    if (!max) return false;
    let n = 0;
    for (const p of peds) {
        if (p.hp > 0 && isLaw(p) && !p.cover && Math.hypot(p.x - player.x, p.y - player.y) < 900) n++;
    }
    return n < max;
}

function onLevelChange(level) {
    const prev = heat.lastLevel;
    heat.lastLevel = level;
    if (level > prev) {
        heat.fillTimer = Math.max(heat.fillTimer, 2.5);
        heat.dispatchCd = Math.min(heat.dispatchCd, 3);
        if (level >= 3 && prev < 3) {
            audio.scanner(false);
            showPager('NBPD DISPATCH: SET UP ROADBLOCKS ON THE BRIDGES AND AVENUES!');
        }
        if (level >= 4 && prev < 4) {
            audio.scanner(true);
            showPager('NBPD DISPATCH: ALL UNITS - SEND IN SWAT! FEDS ARE ROLLING!');
        }
    }
    updateHUD();
}

// Every frame: debounce clocks, line-of-sight cooldown (levels 1-2), dispatch
export function updateHeat(dt) {
    for (const k in heat.cooldowns) if (heat.cooldowns[k] > 0) heat.cooldowns[k] -= dt;
    heat.dispatchCd = Math.max(0, heat.dispatchCd - dt);
    heat.roadblockCd = Math.max(0, heat.roadblockCd - dt);

    const level = Math.floor(player.wanted);
    if (level !== heat.lastLevel) onLevelChange(level);

    // Does any cop see the player? (4 Hz)
    heat.losTimer -= dt;
    if (heat.losTimer <= 0) {
        heat.losTimer = 0.25;
        heat.seen = player.wanted > 0 && lawNear(player.x, player.y, SIGHT_RANGE);
    }
    if (heat.seen || player.wanted <= 0 || player.wanted >= 3) player.unseenTimer = 0;
    else player.unseenTimer += dt;

    // Natural cooldown: lose a star by staying out of sight (levels 3-4 need Spray-B-Gone or a bribe)
    const small = player.wanted < 1;
    const cooling =
        player.probation <= 0 && player.wanted > 0 && player.wanted < 3 && player.unseenTimer > (small ? 2 : 8);
    if (cooling) {
        const rate = small ? 0.12 : player.wanted >= 2 ? 0.1 : 1 / 6;
        player.wanted = Math.max(0, player.wanted - rate * dt);
        if (Math.floor(player.wanted) !== level) onLevelChange(Math.floor(player.wanted));
    }
    const show = cooling && !small;
    if (show !== heat.cooling) {
        heat.cooling = show;
        document.getElementById('hud-wanted')?.classList.toggle('cooling', show);
    }

    updatePursuit(dt, Math.floor(player.wanted));
}

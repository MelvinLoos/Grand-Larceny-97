import { audio } from './audio.js';
import { getLaneCoord } from './city.js';
import { TILE } from './config.js';
import { createCar } from './entities.js';
import { addScore, showBigBanner, showPager, updateHUD } from './hud.js';
import { cars, mission, payphones, peds, player } from './state.js';

// --- WANTED SYSTEM ---
export function addCrime(amount) {
    player.wanted = Math.min(4, player.wanted + amount);
    player.wantedDecay = 18;
    updateHUD();
}

// --- PAYPHONE MISSIONS ---
export function startPayphoneMission(phone) {
    audio.cash();
    const mIdx = mission.completedCount % 3;
    mission.active = true;

    if (mIdx === 0) {
        // Mission 1: Hot Car Delivery (parked cleanly on Westside Plaza pavement)
        mission.type = 'steal_deliver';
        mission.stage = 1;
        const hotCar = createCar('hellcrab', 7.5 * TILE, 17.5 * TILE, 0, 'parked');
        hotCar.color = '#e2559b'; // Neon Pink Boss GTS
        cars.push(hotCar);
        mission.targetEntity = hotCar;
        mission.targetX = hotCar.x;
        mission.targetY = hotCar.y;
        mission.title = 'STEAL THE PINK HELLCRAB GTS IN WESTSIDE!';
        showPager('MAMA VOLTA: STEAL THE PINK HELLCRAB GTS & BRING IT TO EAST DOCKS!');
    } else if (mIdx === 1) {
        // Mission 2: Take Out Rival Syndicate Boss + Guards (on Uptown Plaza sidewalk)
        mission.type = 'assassinate';
        mission.stage = 1;
        const bx = 21.5 * TILE;
        const by = 7.5 * TILE;
        const boss = {
            x: bx,
            y: by,
            angle: 0,
            speed: 70,
            color: '#b8322a',
            role: 'boss',
            hp: 130,
            panicTimer: 0,
            shootTimer: 0.4
        };
        peds.push(boss);
        // Two bodyguards
        for (let g = -1; g <= 1; g += 2) {
            peds.push({
                x: bx + g * 35,
                y: by + 25,
                angle: 0,
                speed: 85,
                color: '#7f1d1d',
                role: 'guard',
                hp: 65,
                panicTimer: 0,
                shootTimer: 0.5
            });
        }
        mission.targetEntity = boss;
        mission.targetX = bx;
        mission.targetY = by;
        mission.title = 'ELIMINATE THE RIVAL CAPO IN UPTOWN!';
        showPager('THE DENTIST: THE RIVAL CAPO IS IN UPTOWN. TIME FOR AN EXTRACTION.');
    } else {
        // Mission 3: Armored Van Destruction (cruising cleanly in eastbound lane)
        mission.type = 'destroy_car';
        mission.stage = 1;
        const armored = createCar('van', 18.5 * TILE, getLaneCoord(22, 0), 0, 'traffic');
        armored.color = '#e0a21b';
        armored.hp = 260;
        armored.maxHp = 260;
        cars.push(armored);
        mission.targetEntity = armored;
        mission.targetX = armored.x;
        mission.targetY = armored.y;
        mission.title = 'BLOW UP THE GOLD ARMORED VAN!';
        player.ammo[3] += 5; // Bonus rockets!
        showPager('COUSIN RICKY: BLOW UP THE GOLD ARMORED VAN! (+5 ROCKETS)');
    }
    updateHUD();
}

export function updateMission(dt) {
    // Ringing payphone check when not in a mission
    if (!mission.active) {
        for (const ph of payphones) {
            ph.ringPhase += dt * 5;
            const dist = Math.hypot(player.x - ph.x, player.y - ph.y);
            if (dist < 420 && Math.floor(ph.ringPhase) % 8 === 0 && Math.random() < 0.06) {
                audio.phoneRing();
            }
            if (!player.inCar && dist < 44 && player.deadTimer <= 0) {
                startPayphoneMission(ph);
                break;
            }
        }
        return;
    }

    // Active Mission Logic
    if (mission.type === 'steal_deliver') {
        const car = mission.targetEntity;
        if (!car || car.hp <= 0) {
            mission.active = false;
            showBigBanner('MISSION FAILED!', 'THE TARGET VEHICLE WAS DESTROYED', '#d23a2a');
            updateHUD();
            return;
        }
        if (mission.stage === 1) {
            mission.targetX = car.x;
            mission.targetY = car.y;
            if (player.inCar === car) {
                mission.stage = 2;
                mission.targetX = 25.5 * TILE;
                mission.targetY = 25.5 * TILE;
                mission.title = 'DELIVER CAR TO SE DOCKS DROP-OFF!';
                addCrime(1.2);
                showPager('COPS SPOTTED YOU! DELIVER IT TO THE SE DOCKYARD CRANE!');
                updateHUD();
            }
        } else if (mission.stage === 2) {
            if (player.inCar === car && Math.hypot(car.x - mission.targetX, car.y - mission.targetY) < 95) {
                completeMission(10000);
            }
        }
    } else if (mission.type === 'assassinate') {
        const boss = mission.targetEntity;
        if (!boss || boss.hp <= 0) {
            completeMission(15000);
        } else {
            mission.targetX = boss.x;
            mission.targetY = boss.y;
        }
    } else if (mission.type === 'destroy_car') {
        const van = mission.targetEntity;
        if (!van || van.hp <= 0) {
            completeMission(20000);
        } else {
            mission.targetX = van.x;
            mission.targetY = van.y;
        }
    }
}

export function completeMission(reward) {
    mission.active = false;
    mission.completedCount++;
    player.multiplier = Math.min(9, player.multiplier + 1);
    addScore(reward, player.x, player.y - 30, 'MISSION');
    audio.cash();
    showBigBanner('MISSION COMPLETE!', `+$${reward * player.multiplier} • MULTIPLIER x${player.multiplier}`, '#ffd400');
    showPager('NICE WORK KID! ANSWER ANOTHER PAYPHONE FOR MORE WORK!');
    updateHUD();
}

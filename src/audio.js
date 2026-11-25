// --- RETRO WEB AUDIO SYNTHESIZER ---
export class RetroAudio {
    constructor() {
        this.ctx = null;
        this.enabled = true;
        this.radioTimer = 0;
        this.radioStep = 0;
        this.sirenPhase = 0;
    }

    init() {
        if (!this.ctx) {
            const AudioCtx = window.AudioContext || window.webkitAudioContext;
            if (AudioCtx) this.ctx = new AudioCtx();
        }
        if (this.ctx && this.ctx.state === 'suspended') {
            this.ctx.resume();
        }
    }

    toggle() {
        this.enabled = !this.enabled;
        this.init();
        return this.enabled;
    }

    playTone(freq, endFreq, duration, type = 'square', gainVal = 0.08) {
        if (!this.enabled || !this.ctx) return;
        try {
            const now = this.ctx.currentTime;
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            osc.type = type;
            osc.frequency.setValueAtTime(freq, now);
            if (endFreq !== freq) {
                osc.frequency.exponentialRampToValueAtTime(Math.max(20, endFreq), now + duration);
            }
            gain.gain.setValueAtTime(gainVal, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
            osc.connect(gain);
            gain.connect(this.ctx.destination);
            osc.start(now);
            osc.stop(now + duration);
        } catch {
            // Ignore audio context edge cases
        }
    }

    playNoise(duration, filterFreq = 900, gainVal = 0.12) {
        if (!this.enabled || !this.ctx) return;
        try {
            const now = this.ctx.currentTime;
            const bufferSize = Math.floor(this.ctx.sampleRate * duration);
            const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
            const data = buffer.getChannelData(0);
            for (let i = 0; i < bufferSize; i++) {
                data[i] = Math.random() * 2 - 1;
            }
            const noise = this.ctx.createBufferSource();
            noise.buffer = buffer;

            const filter = this.ctx.createBiquadFilter();
            filter.type = 'lowpass';
            filter.frequency.setValueAtTime(filterFreq, now);

            const gain = this.ctx.createGain();
            gain.gain.setValueAtTime(gainVal, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

            noise.connect(filter);
            filter.connect(gain);
            gain.connect(this.ctx.destination);
            noise.start(now);
        } catch {
            // Ignore audio context edge cases
        }
    }

    shoot(weaponId) {
        if (weaponId === 0) {
            this.playTone(150, 60, 0.08, 'triangle', 0.08);
        } else if (weaponId === 1) {
            this.playNoise(0.11, 1800, 0.14);
            this.playTone(320, 90, 0.09, 'sawtooth', 0.07);
        } else if (weaponId === 2) {
            this.playNoise(0.07, 2200, 0.11);
            this.playTone(400, 120, 0.06, 'square', 0.06);
        } else {
            this.playNoise(0.28, 700, 0.16);
            this.playTone(180, 55, 0.25, 'sawtooth', 0.1);
        }
    }

    explosion() {
        this.playNoise(0.55, 420, 0.26);
        this.playTone(110, 28, 0.48, 'sawtooth', 0.16);
    }

    cash() {
        this.playTone(880, 1320, 0.09, 'square', 0.07);
        setTimeout(() => this.playTone(1320, 1760, 0.12, 'square', 0.07), 65);
    }

    phoneRing() {
        this.playTone(1100, 1350, 0.07, 'square', 0.035);
    }

    horn(isPolice = false) {
        if (isPolice) {
            this.playTone(680, 960, 0.22, 'sawtooth', 0.09);
        } else {
            this.playTone(340, 340, 0.18, 'sawtooth', 0.09);
            this.playTone(425, 425, 0.18, 'sawtooth', 0.07);
        }
    }

    screech() {
        this.playTone(920 + Math.random() * 160, 780, 0.06, 'triangle', 0.025);
    }

    updateMusicAndSirens(dt, inCar, carType, hasSirenNearby) {
        if (!this.enabled || !this.ctx) return;

        // Police siren pulse
        if (hasSirenNearby) {
            this.sirenPhase += dt;
            if (this.sirenPhase > 0.38) {
                this.sirenPhase = 0;
                const hi = Math.floor(performance.now() / 380) % 2 === 0;
                this.playTone(hi ? 780 : 580, hi ? 820 : 550, 0.32, 'triangle', 0.035);
            }
        }

        // Retro 1997 Funky Bassline Car Radio when driving!
        if (inCar) {
            this.radioTimer += dt;
            if (this.radioTimer >= 0.21) {
                this.radioTimer = 0;
                const groove = [110, 110, 146.8, 110, 164.8, 146.8, 130.8, 98];
                const note = groove[this.radioStep % groove.length];
                const mult = carType === 'hellcrab' ? 1.25 : carType === 'tank' ? 0.75 : 1.0;
                this.playTone(note * mult, note * mult * 0.98, 0.13, 'sawtooth', 0.028);
                if (this.radioStep % 2 === 1) {
                    this.playNoise(0.03, 4500, 0.018); // crisp hi-hat
                }
                this.radioStep++;
            }
        }
    }
}

export const audio = new RetroAudio();

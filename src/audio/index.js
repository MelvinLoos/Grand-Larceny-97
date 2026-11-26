import { AudioCore } from './core.js';
import { radio } from './radio.js';
import { sfx } from './sfx.js';
import { loops } from './vehicles.js';

class AudioManager extends AudioCore {
    onBuild(ctx) {
        this.buildLoops(ctx);
        this.buildRadio(ctx);
    }
}
Object.assign(AudioManager.prototype, sfx, loops, radio);

export const audio = new AudioManager();
audio.attach(); // unlocks on the first keydown / pointerdown

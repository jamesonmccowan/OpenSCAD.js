export class Animation {
	constructor({ render, onChange = () => {}, setTimer = (callback, delay) => setTimeout(callback, delay), clearTimer = (timer) => clearTimeout(timer), now = () => performance.now() }) {
		this.render = render; this.onChange = onChange; this.setTimer = setTimer; this.clearTimer = clearTimer; this.now = now;
		this.time = 0; this.fps = 12; this.steps = 60; this.playing = false; this.busy = false; this.epoch = 0; this.disposed = false;
	}
	configure({ fps = this.fps, steps = this.steps } = {}) {
		if (!Number.isFinite(fps) || fps < 1 || fps > 60 || !Number.isInteger(steps) || steps < 1 || steps > 1000) throw new RangeError("Animation requires FPS 1-60 and 1-1000 steps");
		this.fps = fps; this.steps = steps; this.onChange();
	}
	seek(time) {
		if (!Number.isFinite(time) || time < 0 || time > 1) throw new RangeError("Animation time must be between 0 and 1");
		this.pause(); this.time = time; this.onChange();
	}
	play() {
		if (this.disposed || this.playing) return;
		this.playing = true; ++this.epoch;
		this.time = Math.min(this.steps - 1, Math.floor(this.time * this.steps)) / this.steps;
		this.onChange(); void this.tick();
	}
	pause() { this.playing = false; ++this.epoch; this.clearTimer(this.timer); this.timer = undefined; this.onChange(); }
	async tick() {
		if (!this.playing || this.busy || this.disposed) return;
		this.busy = true;
		const epoch = this.epoch, started = this.now();
		let success;
		try { success = await this.render(this.time); } catch { success = false; }
		finally { this.busy = false; }
		if (!this.playing || this.disposed) return;
		if (epoch === this.epoch && success === false) { this.pause(); return; }
		this.timer = this.setTimer(() => {
			if (epoch === this.epoch) this.time = ((Math.round(this.time * this.steps) + 1) % this.steps) / this.steps;
			this.onChange(); void this.tick();
		}, Math.max(0, 1000 / this.fps - (this.now() - started)));
	}
	dispose() { this.pause(); this.disposed = true; }
}
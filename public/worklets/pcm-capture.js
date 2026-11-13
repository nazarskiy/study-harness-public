class PcmCaptureProcessor extends AudioWorkletProcessor {
	constructor() {
		super();
		this.frame = new Int16Array(2048);
		this.count = 0;
	}

	process(inputs) {
		const channel = inputs[0] && inputs[0][0];
		if (!channel) return true;

		let sumSquares = 0;
		for (let i = 0; i < channel.length; i++) sumSquares += channel[i] * channel[i];
		this.port.postMessage({ type: "level", rms: Math.sqrt(sumSquares / channel.length) });

		for (let i = 0; i < channel.length; i++) {
			const s = Math.max(-1, Math.min(1, channel[i]));
			this.frame[this.count++] = s < 0 ? s * 0x8000 : s * 0x7fff;
			if (this.count === this.frame.length) {
				this.port.postMessage({ type: "audio", buffer: this.frame }, [this.frame.buffer]);
				this.frame = new Int16Array(2048);
				this.count = 0;
			}
		}
		return true;
	}
}

registerProcessor("pcm-capture", PcmCaptureProcessor);

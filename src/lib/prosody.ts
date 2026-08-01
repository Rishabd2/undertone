/**
 * The acoustic channel, provider B: real prosodic features computed in-process
 * from the same microphone audio Deepgram is transcribing.
 *
 * These are genuine measurements, not a mock and not a stand-in for a biomarker
 * model. Every number returned here was computed from the samples handed in. If
 * a window is too short or too quiet to support a feature, that feature is
 * omitted rather than estimated.
 *
 * Honest labeling is mandatory wherever these are displayed:
 *   "Prosodic features computed on-device. Descriptive, not diagnostic."
 *
 * Never convert any of this into a diagnosis. See non-negotiable rules 1 to 3.
 */

export type ProsodicFeature = {
  label: string;
  value: number;
  unit: string;
  /** What was actually measured, in one line, for the UI tooltip. */
  method: string;
};

export type AudioWindow = {
  /** Mono PCM, float samples in [-1, 1]. */
  samples: Float32Array;
  sampleRate: number;
};

const FRAME_MS = 25;
const HOP_MS = 10;

/** Root mean square energy of a frame. */
function rms(frame: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < frame.length; i++) sum += frame[i] * frame[i];
  return Math.sqrt(sum / frame.length);
}

/**
 * Fundamental frequency by autocorrelation, searched over 60 to 400 Hz which
 * covers adult speaking range. Returns 0 when the frame has no clear period.
 */
function estimateF0(frame: Float32Array, sampleRate: number): number {
  const minLag = Math.floor(sampleRate / 400);
  const maxLag = Math.floor(sampleRate / 60);
  if (frame.length < maxLag * 2) return 0;

  let bestLag = 0;
  let bestScore = 0;
  let zeroLagEnergy = 0;
  for (let i = 0; i < frame.length; i++) zeroLagEnergy += frame[i] * frame[i];
  if (zeroLagEnergy === 0) return 0;

  for (let lag = minLag; lag <= maxLag; lag++) {
    let sum = 0;
    for (let i = 0; i < frame.length - lag; i++) {
      sum += frame[i] * frame[i + lag];
    }
    const score = sum / zeroLagEnergy;
    if (score > bestScore) {
      bestScore = score;
      bestLag = lag;
    }
  }
  // Below this correlation the frame is not reliably periodic, so report none.
  if (bestScore < 0.3 || bestLag === 0) return 0;
  return sampleRate / bestLag;
}

/**
 * Compute the feature set. Voiced frames drive pitch statistics; frame energy
 * drives the pause and speech-rate estimates.
 */
export function analyzeWindow(window: AudioWindow): ProsodicFeature[] {
  const { samples, sampleRate } = window;
  const frameLen = Math.floor((FRAME_MS / 1000) * sampleRate);
  const hopLen = Math.floor((HOP_MS / 1000) * sampleRate);
  if (samples.length < frameLen * 4) return [];

  const energies: number[] = [];
  const f0s: number[] = [];
  const voicedFlags: boolean[] = [];

  for (let start = 0; start + frameLen <= samples.length; start += hopLen) {
    const frame = samples.subarray(start, start + frameLen);
    const energy = rms(frame);
    energies.push(energy);
    const f0 = estimateF0(frame, sampleRate);
    const voiced = f0 > 0 && energy > 0.01;
    voicedFlags.push(voiced);
    if (voiced) f0s.push(f0);
  }

  if (energies.length === 0) return [];

  const features: ProsodicFeature[] = [];

  // Silence threshold: a fraction of this window's own median energy, so it
  // adapts to the room rather than assuming a fixed noise floor.
  const sortedEnergy = [...energies].sort((a, b) => a - b);
  const medianEnergy = sortedEnergy[Math.floor(sortedEnergy.length / 2)];
  const silenceThreshold = Math.max(medianEnergy * 0.35, 0.005);
  const silentFrames = energies.filter((e) => e < silenceThreshold).length;
  const pauseRatio = silentFrames / energies.length;

  features.push({
    label: "Pause ratio",
    value: Number(pauseRatio.toFixed(3)),
    unit: "",
    method: `fraction of ${energies.length} frames below an adaptive energy threshold`,
  });

  const voicedFrames = voicedFlags.filter(Boolean).length;
  const voicedSeconds = (voicedFrames * HOP_MS) / 1000;
  features.push({
    label: "Voiced duration",
    value: Number(voicedSeconds.toFixed(2)),
    unit: "s",
    method: "frames with a detectable fundamental frequency and sufficient energy",
  });

  if (f0s.length >= 5) {
    const meanF0 = f0s.reduce((a, b) => a + b, 0) / f0s.length;
    const variance =
      f0s.reduce((acc, f) => acc + (f - meanF0) ** 2, 0) / f0s.length;
    features.push({
      label: "Mean F0",
      value: Math.round(meanF0),
      unit: "Hz",
      method: `autocorrelation over ${f0s.length} voiced frames`,
    });
    features.push({
      label: "F0 std dev",
      value: Number(Math.sqrt(variance).toFixed(1)),
      unit: "Hz",
      method: "standard deviation of per-frame F0",
    });

    // Jitter: mean absolute difference between consecutive periods, as a
    // percentage of the mean period. Standard local jitter definition.
    const periods = f0s.map((f) => 1 / f);
    let periodDiffSum = 0;
    for (let i = 1; i < periods.length; i++) {
      periodDiffSum += Math.abs(periods[i] - periods[i - 1]);
    }
    const meanPeriod = periods.reduce((a, b) => a + b, 0) / periods.length;
    const jitter = (periodDiffSum / (periods.length - 1) / meanPeriod) * 100;
    features.push({
      label: "Jitter (local)",
      value: Number(jitter.toFixed(2)),
      unit: "%",
      method: "mean absolute period difference over mean period",
    });
  }

  // Shimmer: same idea on amplitude, over voiced frames only.
  const voicedEnergies = energies.filter((_, i) => voicedFlags[i]);
  if (voicedEnergies.length >= 5) {
    let ampDiffSum = 0;
    for (let i = 1; i < voicedEnergies.length; i++) {
      ampDiffSum += Math.abs(voicedEnergies[i] - voicedEnergies[i - 1]);
    }
    const meanAmp =
      voicedEnergies.reduce((a, b) => a + b, 0) / voicedEnergies.length;
    const shimmer = (ampDiffSum / (voicedEnergies.length - 1) / meanAmp) * 100;
    features.push({
      label: "Shimmer (local)",
      value: Number(shimmer.toFixed(2)),
      unit: "%",
      method: "mean absolute amplitude difference over mean amplitude",
    });
  }

  return features;
}

/**
 * Speech rate needs the transcript, not just the audio: syllables are counted
 * from the recognized words over the voiced duration. Keeping it separate makes
 * clear that this number depends on Deepgram's output, not on the DSP alone.
 */
export function speechRate(text: string, seconds: number): ProsodicFeature | undefined {
  if (seconds <= 0) return undefined;
  const syllables = countSyllables(text);
  if (syllables === 0) return undefined;
  return {
    label: "Speech rate",
    value: Number((syllables / seconds).toFixed(2)),
    unit: "syll/s",
    method: `${syllables} syllables over ${seconds.toFixed(1)}s of voiced audio`,
  };
}

/** Vowel-group syllable count. Approximate, and labeled as such. */
function countSyllables(text: string): number {
  return text
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .reduce((total, word) => {
      const cleaned = word.replace(/[^a-z]/g, "");
      if (!cleaned) return total;
      const groups = cleaned.match(/[aeiouy]+/g);
      let count = groups ? groups.length : 1;
      if (cleaned.endsWith("e") && count > 1) count -= 1;
      return total + Math.max(1, count);
    }, 0);
}

// AudioContext is created lazily so the first call (the toggle-button click)
// satisfies the browser autoplay user-gesture requirement.

export type TradeAudioTier = 'shark' | 'whale' | 'mega';

export const MEGA_THRESHOLD = 1_000_000;

let ctx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  if (ctx) return ctx;
  const Ctor =
    typeof window === 'undefined'
      ? null
      : (window.AudioContext ??
          (window as typeof window & { webkitAudioContext?: typeof AudioContext })
            .webkitAudioContext);
  if (!Ctor) return null;
  ctx = new Ctor();
  return ctx;
}

function playTone(
  context: AudioContext,
  destination: AudioNode,
  frequency: number,
  gain: number,
  duration: number,
  delay = 0,
  type: OscillatorType = 'sine',
): void {
  const time = context.currentTime + delay;
  const osc = context.createOscillator();
  const gainNode = context.createGain();

  osc.type = type;
  osc.frequency.setValueAtTime(frequency, time);

  gainNode.gain.setValueAtTime(0.001, time);
  gainNode.gain.exponentialRampToValueAtTime(gain, time + 0.01);
  gainNode.gain.exponentialRampToValueAtTime(0.001, time + duration);

  osc.connect(gainNode);
  gainNode.connect(destination);

  osc.start(time);
  osc.stop(time + duration);

  osc.onended = () => {
    gainNode.disconnect();
    osc.disconnect();
  };
}

const BUY = { base: 659.26, second: 830.6, arp: [659.26, 830.6, 987.77, 1318.51] } as const;
const SELL = { base: 493.88, second: 392.0, arp: [493.88, 369.99, 293.66, 246.94] } as const;

export function playTradeCue(side: 'buy' | 'sell', tier: TradeAudioTier, gain = 0.3): void {
  const context = getCtx();
  if (!context) return;
  if (context.state === 'suspended') void context.resume();

  const dest = context.destination;
  const palette = side === 'buy' ? BUY : SELL;

  if (tier === 'shark') {
    playTone(context, dest, palette.base, gain, 0.2);
    return;
  }

  if (tier === 'whale') {
    playTone(context, dest, palette.base, gain, 0.2, 0);
    playTone(context, dest, palette.second, gain, 0.2, 0.08);
    return;
  }

  for (let i = 0; i < palette.arp.length; i++) {
    playTone(context, dest, palette.arp[i]!, gain, 0.18, i * 0.06);
  }
}

export function tierForNotional(notionalUsd: number): TradeAudioTier | null {
  if (notionalUsd >= MEGA_THRESHOLD) return 'mega';
  if (notionalUsd >= 100_000) return 'whale';
  if (notionalUsd >= 10_000) return 'shark';
  return null;
}

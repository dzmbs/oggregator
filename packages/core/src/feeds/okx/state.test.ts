import { describe, expect, it } from 'vitest';
import { buildOkxGreeks } from './state.js';

describe('buildOkxGreeks', () => {
  it('prefers Black-Scholes greeks over portfolio greeks for cross-venue analytics', () => {
    const greeks = buildOkxGreeks({
      instType: 'OPTION',
      instId: 'BTC-USD-270326-90000-C',
      ts: '1',
      delta: '0.28',
      deltaBS: '0.38',
      gamma: '0.20345943695604415',
      gammaBS: '0.000011451336137683688',
      theta: '-120.5',
      thetaBS: '-0.031',
      vega: '14.2',
      vegaBS: '9.8',
      markVol: '0.50',
      bidVol: '0.49',
      askVol: '0.51',
    }, (value) => {
      if (typeof value !== 'string') return null;
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    });

    expect(greeks.delta).toBeCloseTo(0.38, 12);
    expect(greeks.gamma).toBeCloseTo(0.000011451336137683688, 18);
    expect(greeks.theta).toBeCloseTo(-0.031, 12);
    expect(greeks.vega).toBeCloseTo(9.8, 12);
  });
});

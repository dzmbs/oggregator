import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from './app-store';

describe('app-store', () => {
  beforeEach(() => {
    useAppStore.setState({
      underlying: 'BTC',
      expiry: '',
      activeTab: 'chain',
      myIv: '',
    });
  });

  it('setUnderlying clears expiry to prevent invalid pairs', () => {
    useAppStore.getState().setExpiry('2026-03-21');
    expect(useAppStore.getState().expiry).toBe('2026-03-21');

    useAppStore.getState().setUnderlying('ETH');

    expect(useAppStore.getState().underlying).toBe('ETH');
    expect(useAppStore.getState().expiry).toBe('');
  });

  it('setExpiry does not change underlying', () => {
    useAppStore.getState().setExpiry('2026-03-28');

    expect(useAppStore.getState().underlying).toBe('BTC');
    expect(useAppStore.getState().expiry).toBe('2026-03-28');
  });

  it('toggleVenue removes active venue', () => {
    const initial = useAppStore.getState().activeVenues;
    expect(initial).toContain('deribit');

    useAppStore.getState().toggleVenue('deribit');

    expect(useAppStore.getState().activeVenues).not.toContain('deribit');
  });

  it('toggleVenue prevents removing last venue', () => {
    const state = useAppStore.getState();
    const venues = [...state.activeVenues];
    for (const v of venues.slice(1)) {
      useAppStore.getState().toggleVenue(v);
    }

    const remaining = useAppStore.getState().activeVenues;
    expect(remaining).toHaveLength(1);

    useAppStore.getState().toggleVenue(remaining[0]!);
    expect(useAppStore.getState().activeVenues).toHaveLength(1);
  });

  it('changing underlying then setting expiry produces valid pair', () => {
    useAppStore.getState().setUnderlying('SOL');
    expect(useAppStore.getState().expiry).toBe('');

    useAppStore.getState().setExpiry('2026-04-10');

    expect(useAppStore.getState().underlying).toBe('SOL');
    expect(useAppStore.getState().expiry).toBe('2026-04-10');
  });
});

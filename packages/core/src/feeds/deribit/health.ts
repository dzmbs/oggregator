import type { DeribitPlatformState, DeribitPublicStatus } from './types.js';

function isDeribitPublicStatusLocked(locked: DeribitPublicStatus['locked']): boolean {
  return locked === true || locked === 'true' || locked === 'partial';
}

function deribitLockedTargets(status: DeribitPublicStatus): string | null {
  const locked = status.locked_indices ?? status.locked_currencies;
  if (locked == null || locked.length === 0) return null;
  return locked.join(', ');
}

export interface DeribitHealthState {
  lockedPriceIndexes: Set<string>;
  platformMaintenance: boolean;
}

export function createDeribitHealthState(): DeribitHealthState {
  return {
    lockedPriceIndexes: new Set<string>(),
    platformMaintenance: false,
  };
}

export function applyDeribitPlatformState(
  state: DeribitHealthState,
  update: DeribitPlatformState,
): void {
  if (update.maintenance != null) {
    state.platformMaintenance = update.maintenance;
  }

  if (update.price_index == null || update.locked == null) return;

  if (update.locked) {
    state.lockedPriceIndexes.add(update.price_index);
    return;
  }

  state.lockedPriceIndexes.delete(update.price_index);
}

export function deriveDeribitPlatformHealth(state: DeribitHealthState): {
  status: 'connected' | 'degraded';
  message: string;
} {
  if (state.platformMaintenance) {
    return { status: 'degraded', message: 'platform maintenance' };
  }

  if (state.lockedPriceIndexes.size > 0) {
    const indexes = [...state.lockedPriceIndexes].sort().join(', ');
    return { status: 'degraded', message: `locked indices: ${indexes}` };
  }

  return { status: 'connected', message: 'platform healthy' };
}

export function deriveDeribitPublicStatusHealth(
  state: DeribitHealthState,
  status: DeribitPublicStatus | null,
  error?: unknown,
): { status: 'connected' | 'degraded'; message: string } {
  if (error != null) {
    return {
      status: 'degraded',
      message: `public status probe failed: ${String(error)}`,
    };
  }

  if (status == null) {
    return {
      status: 'degraded',
      message: 'public status probe failed',
    };
  }

  if (isDeribitPublicStatusLocked(status.locked)) {
    const locked = deribitLockedTargets(status);
    return {
      status: 'degraded',
      message: locked != null ? `public status locked: ${locked}` : 'public status locked',
    };
  }

  return deriveDeribitPlatformHealth(state);
}

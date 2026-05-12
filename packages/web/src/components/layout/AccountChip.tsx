import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import {
  PRIVATE_ADAPTER_SPECS,
  VENUE_IDS,
  type VenueCredentialFieldKey,
  type VenueCredentials,
  type VenueId,
} from '@oggregator/protocol';

import { useAppStore } from '@stores/app-store';
import { registerUser } from '@features/trading/api';
import { connectVenue, disconnectVenue } from '@features/portfolio/api';
import { VENUES } from '@lib/venue-meta';

import styles from './AccountChip.module.css';

type Mode = 'home' | 'register' | 'paste';
type PasteTarget = 'paper' | VenueId;

const PASTE_TARGETS: { value: PasteTarget; label: string }[] = [
  { value: 'paper', label: 'Paper account' },
  ...VENUE_IDS.map((v) => ({ value: v as PasteTarget, label: VENUES[v]?.label ?? v })),
];

function emptyVenueFields(venue: VenueId): Record<VenueCredentialFieldKey, string> {
  const spec = PRIVATE_ADAPTER_SPECS[venue];
  const fields: Partial<Record<VenueCredentialFieldKey, string>> = {};
  for (const field of spec.credentialFields) fields[field.key] = '';
  return fields as Record<VenueCredentialFieldKey, string>;
}

export default function AccountChip() {
  const apiKey = useAppStore((s) => s.apiKey);
  const accountId = useAppStore((s) => s.accountId);
  const setAuth = useAppStore((s) => s.setAuth);
  const clearAuth = useAppStore((s) => s.clearAuth);
  const venueCreds = useAppStore((s) => s.venueCreds);
  const setVenueCreds = useAppStore((s) => s.setVenueCreds);
  const removeVenueCreds = useAppStore((s) => s.removeVenueCreds);
  const qc = useQueryClient();

  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>('home');
  const [pasteTarget, setPasteTarget] = useState<PasteTarget>('paper');
  const [label, setLabel] = useState('Trader');
  const [pastedPaperKey, setPastedPaperKey] = useState('');
  const [pastedPaperAccount, setPastedPaperAccount] = useState('');
  const [venueFields, setVenueFields] = useState<Record<VenueCredentialFieldKey, string>>(() =>
    emptyVenueFields(VENUE_IDS[0]!),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClickOutside = (event: MouseEvent) => {
      if (wrapRef.current != null && !wrapRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onEsc = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onClickOutside);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onClickOutside);
      document.removeEventListener('keydown', onEsc);
    };
  }, [open]);

  useEffect(() => {
    if (pasteTarget === 'paper') return;
    const existing = venueCreds[pasteTarget];
    if (existing != null) {
      setVenueFields({
        ...emptyVenueFields(pasteTarget),
        ...existing.fields,
      });
    } else {
      setVenueFields(emptyVenueFields(pasteTarget));
    }
    setError(null);
  }, [pasteTarget, venueCreds]);

  const signedIn = apiKey != null && accountId != null;
  const acctShort = accountId != null ? accountId.slice(0, 8) : '';
  const configuredVenues = useMemo(
    () => VENUE_IDS.filter((v) => venueCreds[v] != null),
    [venueCreds],
  );

  const refresh = () => {
    void qc.invalidateQueries();
  };

  const onRegister = async () => {
    const trimmed = label.trim();
    if (trimmed.length < 1 || trimmed.length > 50) {
      setError('Label must be 1–50 characters');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await registerUser(trimmed);
      setAuth(result.apiKey, result.userId, result.accountId);
      refresh();
      setMode('home');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed');
    } finally {
      setBusy(false);
    }
  };

  const onPastePaper = () => {
    const key = pastedPaperKey.trim();
    const acct = pastedPaperAccount.trim();
    if (key.length < 8) {
      setError('API key looks too short');
      return;
    }
    if (acct.length < 1) {
      setError('Account ID required');
      return;
    }
    setAuth(key, 'paste', acct);
    refresh();
    setMode('home');
  };

  const onPasteVenue = async () => {
    if (pasteTarget === 'paper') return;
    const venue = pasteTarget;
    const spec = PRIVATE_ADAPTER_SPECS[venue];
    const missing: string[] = [];
    for (const field of spec.credentialFields) {
      if (field.required && (venueFields[field.key] ?? '').trim().length === 0) {
        missing.push(field.label);
      }
    }
    if (missing.length > 0) {
      setError(`Missing: ${missing.join(', ')}`);
      return;
    }
    const trimmedFields: Record<VenueCredentialFieldKey, string> = { ...venueFields };
    for (const key of Object.keys(trimmedFields) as VenueCredentialFieldKey[]) {
      trimmedFields[key] = trimmedFields[key]!.trim();
    }
    const creds: VenueCredentials = {
      venue,
      fields: trimmedFields,
      addedAt: Date.now(),
    };
    setVenueCreds(creds);

    if (venue === 'derive') {
      setBusy(true);
      try {
        const subaccountIdRaw = trimmedFields.subaccountId ?? '';
        const subaccountId = Number(subaccountIdRaw);
        if (!Number.isFinite(subaccountId) || subaccountId <= 0) {
          throw new Error('Subaccount ID must be a positive integer');
        }
        await connectVenue('derive', {
          walletAddress: trimmedFields.walletAddress ?? '',
          signerPrivateKey: trimmedFields.privateKeyPem ?? '',
          subaccountId,
        });
        refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'connect failed');
        setBusy(false);
        return;
      } finally {
        setBusy(false);
      }
    }

    setError(null);
    setMode('home');
  };

  const onRemoveVenue = async (venue: VenueId) => {
    removeVenueCreds(venue);
    if (venue === 'derive') {
      try {
        await disconnectVenue('derive');
        refresh();
      } catch {}
    }
  };

  const onLogout = () => {
    clearAuth();
    refresh();
    setMode('home');
  };

  const onCopyKey = async () => {
    if (apiKey == null) return;
    try {
      await navigator.clipboard.writeText(apiKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setError('Copy failed');
    }
  };

  const goToPaste = (target: PasteTarget) => {
    setPasteTarget(target);
    setError(null);
    setMode('paste');
  };

  return (
    <div className={styles.wrap} ref={wrapRef}>
      <button
        type="button"
        className={styles.chip}
        data-signed-in={signedIn || undefined}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        <span className={styles.dot} />
        {signedIn ? `acct ${acctShort}` : 'Sign in'}
        {configuredVenues.length > 0 && (
          <span className={styles.venueBadge}>+{configuredVenues.length}</span>
        )}
      </button>
      {open && (
        <div className={styles.popover} role="dialog">
          {mode === 'home' && (
            <div className={styles.body}>
              {signedIn ? (
                <>
                  <div className={styles.section}>
                    <div className={styles.label}>Paper account</div>
                    <div className={styles.value}>{accountId}</div>
                  </div>
                  <div className={styles.section}>
                    <div className={styles.label}>API key</div>
                    <div className={styles.keyRow}>
                      <code className={styles.key}>
                        {apiKey.slice(0, 6)}…{apiKey.slice(-4)}
                      </code>
                      <button type="button" className={styles.smallBtn} onClick={onCopyKey}>
                        {copied ? 'Copied' : 'Copy'}
                      </button>
                    </div>
                  </div>
                  <button type="button" className={styles.dangerBtn} onClick={onLogout}>
                    Sign out
                  </button>
                </>
              ) : (
                <div className={styles.section}>
                  <div className={styles.label}>Paper account</div>
                  <div className={styles.actionRow}>
                    <button
                      type="button"
                      className={styles.primaryBtn}
                      onClick={() => {
                        setMode('register');
                        setError(null);
                      }}
                    >
                      Create new
                    </button>
                    <button
                      type="button"
                      className={styles.secondaryBtn}
                      onClick={() => goToPaste('paper')}
                    >
                      Paste existing
                    </button>
                  </div>
                </div>
              )}
              <div className={styles.divider} />
              <div className={styles.section}>
                <div className={styles.label}>Venue API keys</div>
                {configuredVenues.length === 0 ? (
                  <div className={styles.hint}>
                    No venue keys yet. Add keys to enable per-venue private feeds (see TODOs in code).
                  </div>
                ) : (
                  <div className={styles.venueChipsRow}>
                    {configuredVenues.map((venue) => (
                      <div key={venue} className={styles.venueChip}>
                        <span>{VENUES[venue]?.label ?? venue}</span>
                        <button
                          type="button"
                          className={styles.venueChipRemove}
                          onClick={() => onRemoveVenue(venue)}
                          aria-label={`remove ${venue}`}
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <button
                  type="button"
                  className={styles.secondaryBtn}
                  onClick={() => goToPaste(VENUE_IDS[0]!)}
                >
                  + Add venue key
                </button>
                <div className={styles.warning}>
                  Keys are stored in this browser only. Private WS adapters are TODO — see
                  <code className={styles.codeInline}> protocol/venue-credentials.ts</code>.
                </div>
              </div>
            </div>
          )}

          {mode === 'register' && (
            <div className={styles.body}>
              <button type="button" className={styles.backBtn} onClick={() => setMode('home')}>
                ← back
              </button>
              <label className={styles.field}>
                <span>Label</span>
                <input
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void onRegister();
                  }}
                  placeholder="Trader"
                  autoFocus
                />
              </label>
              <button
                type="button"
                className={styles.primaryBtn}
                onClick={onRegister}
                disabled={busy}
              >
                {busy ? 'Creating…' : 'Create paper account'}
              </button>
              <div className={styles.hint}>
                Generates an API key and a $25k paper account. Stored in this browser.
              </div>
              {error != null && <div className={styles.error}>{error}</div>}
            </div>
          )}

          {mode === 'paste' && (
            <div className={styles.body}>
              <button type="button" className={styles.backBtn} onClick={() => setMode('home')}>
                ← back
              </button>
              <label className={styles.field}>
                <span>Target</span>
                <select
                  value={pasteTarget}
                  onChange={(e) => setPasteTarget(e.target.value as PasteTarget)}
                >
                  {PASTE_TARGETS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </label>

              {pasteTarget === 'paper' ? (
                <>
                  <label className={styles.field}>
                    <span>API key</span>
                    <input
                      value={pastedPaperKey}
                      onChange={(e) => setPastedPaperKey(e.target.value)}
                      placeholder="pk_…"
                      autoFocus
                    />
                  </label>
                  <label className={styles.field}>
                    <span>Account ID</span>
                    <input
                      value={pastedPaperAccount}
                      onChange={(e) => setPastedPaperAccount(e.target.value)}
                      placeholder="acct_…"
                    />
                  </label>
                  <button type="button" className={styles.primaryBtn} onClick={onPastePaper}>
                    Use this key
                  </button>
                  <div className={styles.hint}>
                    Restore a paper account key created earlier.
                  </div>
                </>
              ) : (
                <VenueCredentialForm
                  venue={pasteTarget}
                  values={venueFields}
                  onChange={(key, value) =>
                    setVenueFields((prev) => ({ ...prev, [key]: value }))
                  }
                  onSubmit={onPasteVenue}
                />
              )}
              {error != null && <div className={styles.error}>{error}</div>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface VenueCredentialFormProps {
  venue: VenueId;
  values: Record<VenueCredentialFieldKey, string>;
  onChange: (key: VenueCredentialFieldKey, value: string) => void;
  onSubmit: () => void;
}

function VenueCredentialForm({ venue, values, onChange, onSubmit }: VenueCredentialFormProps) {
  const spec = PRIVATE_ADAPTER_SPECS[venue];
  return (
    <>
      <div className={styles.venueMeta}>
        <span className={styles.venueMetaStatus} data-status={spec.status}>
          {spec.status}
        </span>
        <span className={styles.venueMetaScheme}>{spec.authScheme}</span>
        <a
          className={styles.venueMetaLink}
          href={spec.docsUrl}
          target="_blank"
          rel="noopener noreferrer"
        >
          docs ↗
        </a>
      </div>
      {spec.credentialFields.map((field) => (
        <label key={field.key} className={styles.field}>
          <span>
            {field.label}
            {field.required ? ' *' : ''}
          </span>
          {field.multiline ? (
            <textarea
              value={values[field.key] ?? ''}
              onChange={(e) => onChange(field.key, e.target.value)}
              placeholder={field.placeholder}
              rows={4}
            />
          ) : (
            <input
              type={field.secret ? 'password' : 'text'}
              value={values[field.key] ?? ''}
              onChange={(e) => onChange(field.key, e.target.value)}
              placeholder={field.placeholder}
              autoComplete="off"
            />
          )}
        </label>
      ))}
      <button type="button" className={styles.primaryBtn} onClick={onSubmit}>
        Save {VENUES[venue]?.label ?? venue} keys
      </button>
      <div className={styles.hint}>
        Private WS adapter status: <strong>{spec.status}</strong>. Once available, the Portfolio
        tab&apos;s source toggle will include <strong>{VENUES[venue]?.label ?? venue}</strong>.
      </div>
    </>
  );
}

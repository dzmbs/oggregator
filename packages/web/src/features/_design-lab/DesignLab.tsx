import type { EnrichedStrike, EnrichedSide, VenueQuote } from '@shared/enriched';

import { VENUES } from '@lib/venue-meta';
import { venueColor } from '@lib/colors';
import { fmtUsd, fmtDelta } from '@lib/format';
import { IvChip, SpreadPill } from '@components/ui';

import { MOCK_STRIKES, MOCK_ATM_STRIKE, MOCK_FORWARD_PRICE, MOCK_ACTIVE_VENUES } from './mock-data';
import styles from './DesignLab.module.css';

// ── Format helpers ────────────────────────────────────────────────────────────

function fmtGamma(v: number | null): string {
  if (v == null) return '–';
  return `${Math.round(v * 1e6)}`;
}

function fmtVega(v: number | null): string {
  if (v == null) return '–';
  return `${Math.round(v)}`;
}

function bestQuoteFromSide(side: EnrichedSide): VenueQuote | null {
  if (side.bestVenue == null) return null;
  return side.venues[side.bestVenue] ?? null;
}

// ── Forward marker ────────────────────────────────────────────────────────────

function FwdMarker() {
  return (
    <div className={styles.atmMarker}>
      <div className={styles.atmLine} />
      <div className={styles.atmPill}>
        <span className={styles.atmPillText}>Fwd {fmtUsd(MOCK_FORWARD_PRICE)}</span>
      </div>
      <div className={styles.atmLine} />
    </div>
  );
}

// ── Strike center cell ────────────────────────────────────────────────────────

interface StrikeCenterProps {
  strike: number;
  isAtm: boolean;
}

function StrikeCenter({ strike, isAtm }: StrikeCenterProps) {
  return (
    <div className={`${styles.strikeCell} ${isAtm ? styles.strikeCellAtm : ''}`}>
      {isAtm && <span className={styles.strikeAtmBadge}>ATM</span>}
      <span className={`${styles.strikeNum} ${isAtm ? styles.strikeNumAtm : ''}`}>
        {strike.toLocaleString()}
      </span>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// V1 — Full Spread
// Layout: VENUES | SPREAD | MID | IV | Δ | γ | ν | STRIKE | ν | γ | Δ | IV | MID | SPREAD | VENUES
// ═══════════════════════════════════════════════════════════════════════════════

interface V1VenueColumnProps {
  side: EnrichedSide;
  align: 'left' | 'right';
}

function V1VenueColumn({ side, align }: V1VenueColumnProps) {
  const entries = Object.entries(side.venues).filter(([v]) => MOCK_ACTIVE_VENUES.includes(v));

  return (
    <div className={`${styles.v1VenueCol} ${align === 'right' ? styles.v1VenueColRight : ''}`}>
      {entries.map(([venueId]) => {
        const meta = VENUES[venueId];
        const isBest = venueId === side.bestVenue;
        return (
          <div
            key={venueId}
            className={`${styles.v1LogoItem} ${isBest ? styles.v1LogoItemBest : ''}`}
            title={`${meta?.label ?? venueId}${isBest ? ' — best' : ''}`}
          >
            {meta?.logo ? (
              <img
                src={meta.logo}
                alt={meta?.shortLabel ?? venueId}
                className={styles.v1Logo}
                style={{ opacity: isBest ? 1 : 0.35 }}
              />
            ) : (
              <span
                className={styles.v1FallbackLabel}
                style={{ color: isBest ? venueColor(venueId) : undefined }}
              >
                {meta?.shortLabel ?? venueId.slice(0, 3).toUpperCase()}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

interface V1RowProps {
  s: EnrichedStrike;
  isAtm: boolean;
}

function V1Row({ s, isAtm }: V1RowProps) {
  const callQ = bestQuoteFromSide(s.call);
  const putQ = bestQuoteFromSide(s.put);
  const callItm = s.strike < MOCK_FORWARD_PRICE;
  const putItm = s.strike > MOCK_FORWARD_PRICE;
  const bg = isAtm ? { background: 'rgba(80, 210, 193, 0.04)' } : undefined;

  return (
    <div className={`${styles.strikeRowGrid} ${styles.v1Grid}`} style={bg}>
      {/* CALL side: VENUES | SPREAD | MID | IV | Δ | γ | ν */}
      <V1VenueColumn side={s.call} align="left" />
      <div className={`${styles.spreadCell} ${callItm ? styles.itmCall : ''}`}>
        <SpreadPill spreadPct={callQ?.spreadPct ?? null} />
      </div>
      <span className={`${styles.midCell} ${callItm ? styles.itmCall : ''}`}>
        {fmtUsd(callQ?.mid ?? null)}
      </span>
      <div className={`${styles.ivCell} ${callItm ? styles.itmCall : ''}`}>
        <IvChip iv={s.call.bestIv} size="sm" />
      </div>
      <span className={`${styles.deltaCell} ${callItm ? styles.itmCall : ''}`}>
        {fmtDelta(callQ?.delta ?? null)}
      </span>
      <span className={`${styles.greekCell} ${callItm ? styles.itmCall : ''}`}>
        {fmtGamma(callQ?.gamma ?? null)}
      </span>
      <span className={`${styles.greekCell} ${callItm ? styles.itmCall : ''}`}>
        {fmtVega(callQ?.vega ?? null)}
      </span>

      {/* CENTER */}
      <StrikeCenter strike={s.strike} isAtm={isAtm} />

      {/* PUT side: ν | γ | Δ | IV | MID | SPREAD | VENUES */}
      <span
        className={`${styles.greekCell} ${styles.greekCellRight} ${putItm ? styles.itmPut : ''}`}
      >
        {fmtVega(putQ?.vega ?? null)}
      </span>
      <span
        className={`${styles.greekCell} ${styles.greekCellRight} ${putItm ? styles.itmPut : ''}`}
      >
        {fmtGamma(putQ?.gamma ?? null)}
      </span>
      <span
        className={`${styles.deltaCell} ${styles.deltaCellRight} ${putItm ? styles.itmPut : ''}`}
      >
        {fmtDelta(putQ?.delta ?? null)}
      </span>
      <div className={`${styles.ivCell} ${styles.ivCellRight} ${putItm ? styles.itmPut : ''}`}>
        <IvChip iv={s.put.bestIv} size="sm" />
      </div>
      <span className={`${styles.midCell} ${styles.midCellRight} ${putItm ? styles.itmPut : ''}`}>
        {fmtUsd(putQ?.mid ?? null)}
      </span>
      <div
        className={`${styles.spreadCell} ${styles.spreadCellRight} ${putItm ? styles.itmPut : ''}`}
      >
        <SpreadPill spreadPct={putQ?.spreadPct ?? null} />
      </div>
      <V1VenueColumn side={s.put} align="right" />
    </div>
  );
}

function V1() {
  return (
    <div className={styles.tableWrap}>
      <div className={`${styles.tableHeader} ${styles.v1Grid}`}>
        <span className={styles.hdrLabel}>VENUES</span>
        <span className={styles.hdrLabel}>SPRD</span>
        <span className={styles.hdrLabel}>MID</span>
        <span className={styles.hdrLabel}>IV</span>
        <span className={styles.hdrLabel}>Δ</span>
        <span className={styles.hdrLabel}>γ×10⁻⁶</span>
        <span className={styles.hdrLabel}>ν</span>
        <span className={styles.hdrLabel} data-align="center">
          STRIKE
        </span>
        <span className={styles.hdrLabel} data-align="right">
          ν
        </span>
        <span className={styles.hdrLabel} data-align="right">
          γ×10⁻⁶
        </span>
        <span className={styles.hdrLabel} data-align="right">
          Δ
        </span>
        <span className={styles.hdrLabel} data-align="right">
          IV
        </span>
        <span className={styles.hdrLabel} data-align="right">
          MID
        </span>
        <span className={styles.hdrLabel} data-align="right">
          SPRD
        </span>
        <span className={styles.hdrLabel} data-align="right">
          VENUES
        </span>
      </div>
      {MOCK_STRIKES.map((s) => (
        <div key={s.strike}>
          {s.strike === MOCK_ATM_STRIKE && <FwdMarker />}
          <V1Row s={s} isAtm={s.strike === MOCK_ATM_STRIKE} />
        </div>
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// V2 — Tight Core
// Layout: VENUES | MID | IV | Δ/γ/ν | SPREAD | STRIKE | SPREAD | Δ/γ/ν | IV | MID | VENUES
// ═══════════════════════════════════════════════════════════════════════════════

interface V2VenueColumnProps {
  side: EnrichedSide;
  align: 'left' | 'right';
}

function V2VenueColumn({ side, align }: V2VenueColumnProps) {
  const entries = Object.entries(side.venues).filter(([v]) => MOCK_ACTIVE_VENUES.includes(v));
  const isRight = align === 'right';

  return (
    <div className={`${styles.v2VenueCol} ${isRight ? styles.v2VenueColRight : ''}`}>
      {entries.map(([venueId]) => {
        const meta = VENUES[venueId];
        const isBest = venueId === side.bestVenue;
        const color = venueColor(venueId);
        return (
          <div
            key={venueId}
            className={`${styles.v2LogoItem} ${isBest ? styles.v2LogoItemBest : ''}`}
            title={meta?.label ?? venueId}
          >
            {meta?.logo ? (
              <img
                src={meta.logo}
                alt={meta?.shortLabel ?? venueId}
                className={styles.v2Logo}
                style={{ opacity: isBest ? 1 : 0.35 }}
              />
            ) : (
              <span style={{ color: isBest ? color : undefined, fontSize: 8, fontWeight: 700 }}>
                {meta?.shortLabel ?? venueId.slice(0, 3).toUpperCase()}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

interface V2GreekGroupProps {
  delta: number | null;
  gamma: number | null;
  vega: number | null;
  align: 'left' | 'right';
}

function V2GreekGroup({ delta, gamma, vega, align }: V2GreekGroupProps) {
  const isRight = align === 'right';
  return (
    <div className={`${styles.v2GreekGroup} ${isRight ? styles.v2GreekGroupRight : ''}`}>
      <span className={styles.v2DeltaVal}>{fmtDelta(delta)}</span>
      <span className={styles.v2SubGreeks}>
        <span className={styles.v2SubGreekLabel}>γ</span>
        <span className={styles.v2SubGreekVal}>{fmtGamma(gamma)}</span>
        <span className={styles.v2SubGreekSep} />
        <span className={styles.v2SubGreekLabel}>ν</span>
        <span className={styles.v2SubGreekVal}>{fmtVega(vega)}</span>
      </span>
    </div>
  );
}

interface V2RowProps {
  s: EnrichedStrike;
  isAtm: boolean;
}

function V2Row({ s, isAtm }: V2RowProps) {
  const callQ = bestQuoteFromSide(s.call);
  const putQ = bestQuoteFromSide(s.put);
  const callItm = s.strike < MOCK_FORWARD_PRICE;
  const putItm = s.strike > MOCK_FORWARD_PRICE;
  const bg = isAtm ? { background: 'rgba(80, 210, 193, 0.04)' } : undefined;

  return (
    <div className={`${styles.strikeRowGrid} ${styles.v2Grid}`} style={bg}>
      <V2VenueColumn side={s.call} align="left" />
      <span className={`${styles.midCell} ${callItm ? styles.itmCall : ''}`}>
        {fmtUsd(callQ?.mid ?? null)}
      </span>
      <div className={`${styles.ivCell} ${callItm ? styles.itmCall : ''}`}>
        <IvChip iv={s.call.bestIv} size="sm" />
      </div>
      <V2GreekGroup
        delta={callQ?.delta ?? null}
        gamma={callQ?.gamma ?? null}
        vega={callQ?.vega ?? null}
        align="left"
      />
      <div className={`${styles.spreadCell} ${callItm ? styles.itmCall : ''}`}>
        <SpreadPill spreadPct={callQ?.spreadPct ?? null} />
      </div>

      <StrikeCenter strike={s.strike} isAtm={isAtm} />

      <div
        className={`${styles.spreadCell} ${styles.spreadCellRight} ${putItm ? styles.itmPut : ''}`}
      >
        <SpreadPill spreadPct={putQ?.spreadPct ?? null} />
      </div>
      <V2GreekGroup
        delta={putQ?.delta ?? null}
        gamma={putQ?.gamma ?? null}
        vega={putQ?.vega ?? null}
        align="right"
      />
      <div className={`${styles.ivCell} ${styles.ivCellRight} ${putItm ? styles.itmPut : ''}`}>
        <IvChip iv={s.put.bestIv} size="sm" />
      </div>
      <span className={`${styles.midCell} ${styles.midCellRight} ${putItm ? styles.itmPut : ''}`}>
        {fmtUsd(putQ?.mid ?? null)}
      </span>
      <V2VenueColumn side={s.put} align="right" />
    </div>
  );
}

function V2() {
  return (
    <div className={styles.tableWrap}>
      <div className={`${styles.tableHeader} ${styles.v2Grid}`}>
        <span className={styles.hdrLabel}>VENUES</span>
        <span className={styles.hdrLabel}>MID</span>
        <span className={styles.hdrLabel}>IV</span>
        <span className={styles.hdrLabel}>Δ / γ / ν</span>
        <span className={styles.hdrLabel}>SPRD</span>
        <span className={styles.hdrLabel} data-align="center">
          STRIKE
        </span>
        <span className={styles.hdrLabel}>SPRD</span>
        <span className={styles.hdrLabel} data-align="right">
          Δ / γ / ν
        </span>
        <span className={styles.hdrLabel} data-align="right">
          IV
        </span>
        <span className={styles.hdrLabel} data-align="right">
          MID
        </span>
        <span className={styles.hdrLabel} data-align="right">
          VENUES
        </span>
      </div>
      {MOCK_STRIKES.map((s) => (
        <div key={s.strike}>
          {s.strike === MOCK_ATM_STRIKE && <FwdMarker />}
          <V2Row s={s} isAtm={s.strike === MOCK_ATM_STRIKE} />
        </div>
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// V3 — Minimal Venues
// Layout: BEST | MID | IV | Δ | γ | ν | SPREAD | STRIKE | SPREAD | ν | γ | Δ | IV | MID | BEST
// ═══════════════════════════════════════════════════════════════════════════════

interface V3BestBadgeProps {
  side: EnrichedSide;
  align: 'left' | 'right';
}

function V3BestBadge({ side, align }: V3BestBadgeProps) {
  const meta = side.bestVenue != null ? VENUES[side.bestVenue] : null;
  const color = side.bestVenue != null ? venueColor(side.bestVenue) : 'transparent';
  const venueCount = Object.keys(side.venues).filter((v) => MOCK_ACTIVE_VENUES.includes(v)).length;
  const supDigits = ['⁰', '¹', '²', '³', '⁴', '⁵', '⁶', '⁷', '⁸', '⁹'];
  const sup = venueCount > 1 ? (supDigits[venueCount] ?? `+${venueCount}`) : '';
  const isRight = align === 'right';

  return (
    <div className={`${styles.v3BestBadge} ${isRight ? styles.v3BestBadgeRight : ''}`}>
      <div className={styles.v3BestLogoWrap} style={{ borderColor: color }}>
        {meta?.logo ? (
          <img src={meta.logo} alt={meta?.shortLabel ?? ''} className={styles.v3BestLogo} />
        ) : (
          <span className={styles.v3BestFallback} style={{ color }}>
            {meta?.shortLabel ?? side.bestVenue?.slice(0, 3).toUpperCase() ?? '–'}
          </span>
        )}
        {sup && <span className={styles.v3Superscript}>{sup}</span>}
      </div>
    </div>
  );
}

interface V3RowProps {
  s: EnrichedStrike;
  isAtm: boolean;
}

function V3Row({ s, isAtm }: V3RowProps) {
  const callQ = bestQuoteFromSide(s.call);
  const putQ = bestQuoteFromSide(s.put);
  const callItm = s.strike < MOCK_FORWARD_PRICE;
  const putItm = s.strike > MOCK_FORWARD_PRICE;
  const bg = isAtm ? { background: 'rgba(80, 210, 193, 0.04)' } : undefined;

  return (
    <div className={`${styles.strikeRowGrid} ${styles.v3Grid}`} style={bg}>
      <V3BestBadge side={s.call} align="left" />
      <span className={`${styles.midCell} ${callItm ? styles.itmCall : ''}`}>
        {fmtUsd(callQ?.mid ?? null)}
      </span>
      <div className={`${styles.ivCell} ${callItm ? styles.itmCall : ''}`}>
        <IvChip iv={s.call.bestIv} size="sm" />
      </div>
      <span className={`${styles.deltaCell} ${callItm ? styles.itmCall : ''}`}>
        {fmtDelta(callQ?.delta ?? null)}
      </span>
      <span className={`${styles.greekCell} ${callItm ? styles.itmCall : ''}`}>
        {fmtGamma(callQ?.gamma ?? null)}
      </span>
      <span className={`${styles.greekCell} ${callItm ? styles.itmCall : ''}`}>
        {fmtVega(callQ?.vega ?? null)}
      </span>
      <div className={`${styles.spreadCell} ${callItm ? styles.itmCall : ''}`}>
        <SpreadPill spreadPct={callQ?.spreadPct ?? null} />
      </div>

      <StrikeCenter strike={s.strike} isAtm={isAtm} />

      <div
        className={`${styles.spreadCell} ${styles.spreadCellRight} ${putItm ? styles.itmPut : ''}`}
      >
        <SpreadPill spreadPct={putQ?.spreadPct ?? null} />
      </div>
      <span
        className={`${styles.greekCell} ${styles.greekCellRight} ${putItm ? styles.itmPut : ''}`}
      >
        {fmtVega(putQ?.vega ?? null)}
      </span>
      <span
        className={`${styles.greekCell} ${styles.greekCellRight} ${putItm ? styles.itmPut : ''}`}
      >
        {fmtGamma(putQ?.gamma ?? null)}
      </span>
      <span
        className={`${styles.deltaCell} ${styles.deltaCellRight} ${putItm ? styles.itmPut : ''}`}
      >
        {fmtDelta(putQ?.delta ?? null)}
      </span>
      <div className={`${styles.ivCell} ${styles.ivCellRight} ${putItm ? styles.itmPut : ''}`}>
        <IvChip iv={s.put.bestIv} size="sm" />
      </div>
      <span className={`${styles.midCell} ${styles.midCellRight} ${putItm ? styles.itmPut : ''}`}>
        {fmtUsd(putQ?.mid ?? null)}
      </span>
      <V3BestBadge side={s.put} align="right" />
    </div>
  );
}

function V3() {
  return (
    <div className={styles.tableWrap}>
      <div className={`${styles.tableHeader} ${styles.v3Grid}`}>
        <span className={styles.hdrLabel} data-align="center">
          BEST
        </span>
        <span className={styles.hdrLabel}>MID</span>
        <span className={styles.hdrLabel}>IV</span>
        <span className={styles.hdrLabel}>Δ</span>
        <span className={styles.hdrLabel}>γ×10⁻⁶</span>
        <span className={styles.hdrLabel}>ν</span>
        <span className={styles.hdrLabel}>SPRD</span>
        <span className={styles.hdrLabel} data-align="center">
          STRIKE
        </span>
        <span className={styles.hdrLabel} data-align="right">
          SPRD
        </span>
        <span className={styles.hdrLabel} data-align="right">
          ν
        </span>
        <span className={styles.hdrLabel} data-align="right">
          γ×10⁻⁶
        </span>
        <span className={styles.hdrLabel} data-align="right">
          Δ
        </span>
        <span className={styles.hdrLabel} data-align="right">
          IV
        </span>
        <span className={styles.hdrLabel} data-align="right">
          MID
        </span>
        <span className={styles.hdrLabel} data-align="center">
          BEST
        </span>
      </div>
      {MOCK_STRIKES.map((s) => (
        <div key={s.strike}>
          {s.strike === MOCK_ATM_STRIKE && <FwdMarker />}
          <V3Row s={s} isAtm={s.strike === MOCK_ATM_STRIKE} />
        </div>
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// V4 — Edge Badges
// Layout: VENUE TAGS | MID | IV | Δ | γ | ν | SPREAD | STRIKE | SPREAD | ν | γ | Δ | IV | MID | VENUE TAGS
// ═══════════════════════════════════════════════════════════════════════════════

interface V4TagsColumnProps {
  side: EnrichedSide;
  align: 'left' | 'right';
}

function V4TagsColumn({ side, align }: V4TagsColumnProps) {
  const entries = Object.entries(side.venues).filter(([v]) => MOCK_ACTIVE_VENUES.includes(v));
  const isRight = align === 'right';

  return (
    <div className={`${styles.v4TagsCol} ${isRight ? styles.v4TagsColRight : ''}`}>
      {entries.map(([venueId]) => {
        const meta = VENUES[venueId];
        const isBest = venueId === side.bestVenue;
        const color = venueColor(venueId);
        const label = meta?.shortLabel ?? venueId.slice(0, 3).toUpperCase();
        return (
          <span
            key={venueId}
            className={`${styles.v4Tag} ${isBest ? styles.v4TagBest : ''}`}
            style={
              isBest
                ? { background: color, color: '#0A0A0A' }
                : { borderColor: color, color: color }
            }
            title={meta?.label ?? venueId}
          >
            {label}
          </span>
        );
      })}
    </div>
  );
}

interface V4RowProps {
  s: EnrichedStrike;
  isAtm: boolean;
}

function V4Row({ s, isAtm }: V4RowProps) {
  const callQ = bestQuoteFromSide(s.call);
  const putQ = bestQuoteFromSide(s.put);
  const callItm = s.strike < MOCK_FORWARD_PRICE;
  const putItm = s.strike > MOCK_FORWARD_PRICE;
  const bg = isAtm ? { background: 'rgba(80, 210, 193, 0.04)' } : undefined;

  return (
    <div className={`${styles.strikeRowGrid} ${styles.v4Grid}`} style={bg}>
      <V4TagsColumn side={s.call} align="left" />
      <span className={`${styles.midCell} ${callItm ? styles.itmCall : ''}`}>
        {fmtUsd(callQ?.mid ?? null)}
      </span>
      <div className={`${styles.ivCell} ${callItm ? styles.itmCall : ''}`}>
        <IvChip iv={s.call.bestIv} size="sm" />
      </div>
      <span className={`${styles.deltaCell} ${callItm ? styles.itmCall : ''}`}>
        {fmtDelta(callQ?.delta ?? null)}
      </span>
      <span className={`${styles.greekCell} ${callItm ? styles.itmCall : ''}`}>
        {fmtGamma(callQ?.gamma ?? null)}
      </span>
      <span className={`${styles.greekCell} ${callItm ? styles.itmCall : ''}`}>
        {fmtVega(callQ?.vega ?? null)}
      </span>
      <div className={`${styles.spreadCell} ${callItm ? styles.itmCall : ''}`}>
        <SpreadPill spreadPct={callQ?.spreadPct ?? null} />
      </div>

      <StrikeCenter strike={s.strike} isAtm={isAtm} />

      <div
        className={`${styles.spreadCell} ${styles.spreadCellRight} ${putItm ? styles.itmPut : ''}`}
      >
        <SpreadPill spreadPct={putQ?.spreadPct ?? null} />
      </div>
      <span
        className={`${styles.greekCell} ${styles.greekCellRight} ${putItm ? styles.itmPut : ''}`}
      >
        {fmtVega(putQ?.vega ?? null)}
      </span>
      <span
        className={`${styles.greekCell} ${styles.greekCellRight} ${putItm ? styles.itmPut : ''}`}
      >
        {fmtGamma(putQ?.gamma ?? null)}
      </span>
      <span
        className={`${styles.deltaCell} ${styles.deltaCellRight} ${putItm ? styles.itmPut : ''}`}
      >
        {fmtDelta(putQ?.delta ?? null)}
      </span>
      <div className={`${styles.ivCell} ${styles.ivCellRight} ${putItm ? styles.itmPut : ''}`}>
        <IvChip iv={s.put.bestIv} size="sm" />
      </div>
      <span className={`${styles.midCell} ${styles.midCellRight} ${putItm ? styles.itmPut : ''}`}>
        {fmtUsd(putQ?.mid ?? null)}
      </span>
      <V4TagsColumn side={s.put} align="right" />
    </div>
  );
}

function V4() {
  return (
    <div className={styles.tableWrap}>
      <div className={`${styles.tableHeader} ${styles.v4Grid}`}>
        <span className={styles.hdrLabel}>VENUES</span>
        <span className={styles.hdrLabel}>MID</span>
        <span className={styles.hdrLabel}>IV</span>
        <span className={styles.hdrLabel}>Δ</span>
        <span className={styles.hdrLabel}>γ×10⁻⁶</span>
        <span className={styles.hdrLabel}>ν</span>
        <span className={styles.hdrLabel}>SPRD</span>
        <span className={styles.hdrLabel} data-align="center">
          STRIKE
        </span>
        <span className={styles.hdrLabel}>SPRD</span>
        <span className={styles.hdrLabel} data-align="right">
          ν
        </span>
        <span className={styles.hdrLabel} data-align="right">
          γ×10⁻⁶
        </span>
        <span className={styles.hdrLabel} data-align="right">
          Δ
        </span>
        <span className={styles.hdrLabel} data-align="right">
          IV
        </span>
        <span className={styles.hdrLabel} data-align="right">
          MID
        </span>
        <span className={styles.hdrLabel} data-align="right">
          VENUES
        </span>
      </div>
      {MOCK_STRIKES.map((s) => (
        <div key={s.strike}>
          {s.strike === MOCK_ATM_STRIKE && <FwdMarker />}
          <V4Row s={s} isAtm={s.strike === MOCK_ATM_STRIKE} />
        </div>
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// V5 — Borderless Flow
// Layout: VENUES | MID | IV | Δ | γ | ν | SPREAD | STRIKE | SPREAD | ν | γ | Δ | IV | MID | VENUES
// Venues as stacked logos, no box borders — best row gets a teal strip across the full row
// ═══════════════════════════════════════════════════════════════════════════════

interface V5VenueColumnProps {
  side: EnrichedSide;
  align: 'left' | 'right';
}

function V5VenueColumn({ side, align }: V5VenueColumnProps) {
  const entries = Object.entries(side.venues).filter(([v]) => MOCK_ACTIVE_VENUES.includes(v));
  const isRight = align === 'right';

  return (
    <div className={`${styles.v5VenueCol} ${isRight ? styles.v5VenueColRight : ''}`}>
      {entries.map(([venueId]) => {
        const meta = VENUES[venueId];
        const isBest = venueId === side.bestVenue;
        return (
          <div
            key={venueId}
            className={`${styles.v5LogoItem} ${isBest ? styles.v5LogoItemBest : ''}`}
            title={`${meta?.label ?? venueId}${isBest ? ' — best' : ''}`}
          >
            {meta?.logo ? (
              <img
                src={meta.logo}
                alt={meta?.shortLabel ?? venueId}
                className={styles.v5Logo}
                style={{ opacity: isBest ? 1 : 0.3 }}
              />
            ) : (
              <span
                className={styles.v5FallbackLabel}
                style={{ opacity: isBest ? 1 : 0.35, color: venueColor(venueId) }}
              >
                {meta?.shortLabel ?? venueId.slice(0, 3).toUpperCase()}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

interface V5RowProps {
  s: EnrichedStrike;
  isAtm: boolean;
}

function V5Row({ s, isAtm }: V5RowProps) {
  const callQ = bestQuoteFromSide(s.call);
  const putQ = bestQuoteFromSide(s.put);
  const callItm = s.strike < MOCK_FORWARD_PRICE;
  const putItm = s.strike > MOCK_FORWARD_PRICE;
  const atmBg = isAtm ? 'rgba(80, 210, 193, 0.04)' : undefined;

  return (
    <div
      className={`${styles.strikeRowGrid} ${styles.v5Grid}`}
      style={atmBg ? { background: atmBg } : undefined}
    >
      <V5VenueColumn side={s.call} align="left" />
      <span className={`${styles.midCell} ${callItm ? styles.itmCall : ''}`}>
        {fmtUsd(callQ?.mid ?? null)}
      </span>
      <div className={`${styles.ivCell} ${callItm ? styles.itmCall : ''}`}>
        <IvChip iv={s.call.bestIv} size="sm" />
      </div>
      <span className={`${styles.deltaCell} ${callItm ? styles.itmCall : ''}`}>
        {fmtDelta(callQ?.delta ?? null)}
      </span>
      <span className={`${styles.v5GammaCell} ${callItm ? styles.itmCall : ''}`}>
        {fmtGamma(callQ?.gamma ?? null)}
      </span>
      <span className={`${styles.v5VegaCell} ${callItm ? styles.itmCall : ''}`}>
        {fmtVega(callQ?.vega ?? null)}
      </span>
      <div className={`${styles.spreadCell} ${callItm ? styles.itmCall : ''}`}>
        <SpreadPill spreadPct={callQ?.spreadPct ?? null} />
      </div>

      <StrikeCenter strike={s.strike} isAtm={isAtm} />

      <div
        className={`${styles.spreadCell} ${styles.spreadCellRight} ${putItm ? styles.itmPut : ''}`}
      >
        <SpreadPill spreadPct={putQ?.spreadPct ?? null} />
      </div>
      <span
        className={`${styles.v5VegaCell} ${styles.v5VegaCellRight} ${putItm ? styles.itmPut : ''}`}
      >
        {fmtVega(putQ?.vega ?? null)}
      </span>
      <span
        className={`${styles.v5GammaCell} ${styles.v5GammaCellRight} ${putItm ? styles.itmPut : ''}`}
      >
        {fmtGamma(putQ?.gamma ?? null)}
      </span>
      <span
        className={`${styles.deltaCell} ${styles.deltaCellRight} ${putItm ? styles.itmPut : ''}`}
      >
        {fmtDelta(putQ?.delta ?? null)}
      </span>
      <div className={`${styles.ivCell} ${styles.ivCellRight} ${putItm ? styles.itmPut : ''}`}>
        <IvChip iv={s.put.bestIv} size="sm" />
      </div>
      <span className={`${styles.midCell} ${styles.midCellRight} ${putItm ? styles.itmPut : ''}`}>
        {fmtUsd(putQ?.mid ?? null)}
      </span>
      <V5VenueColumn side={s.put} align="right" />
    </div>
  );
}

function V5() {
  return (
    <div className={styles.tableWrap}>
      <div className={`${styles.tableHeader} ${styles.v5Grid}`}>
        <span className={styles.hdrLabel}>VENUES</span>
        <span className={styles.hdrLabel}>MID</span>
        <span className={styles.hdrLabel}>IV</span>
        <span className={styles.hdrLabel}>Δ</span>
        <span className={styles.hdrLabel}>γ</span>
        <span className={styles.hdrLabel}>ν</span>
        <span className={styles.hdrLabel}>SPRD</span>
        <span className={styles.hdrLabel} data-align="center">
          STRIKE
        </span>
        <span className={styles.hdrLabel}>SPRD</span>
        <span className={styles.hdrLabel} data-align="right">
          ν
        </span>
        <span className={styles.hdrLabel} data-align="right">
          γ
        </span>
        <span className={styles.hdrLabel} data-align="right">
          Δ
        </span>
        <span className={styles.hdrLabel} data-align="right">
          IV
        </span>
        <span className={styles.hdrLabel} data-align="right">
          MID
        </span>
        <span className={styles.hdrLabel} data-align="right">
          VENUES
        </span>
      </div>
      {MOCK_STRIKES.map((s) => (
        <div key={s.strike}>
          {s.strike === MOCK_ATM_STRIKE && <FwdMarker />}
          <V5Row s={s} isAtm={s.strike === MOCK_ATM_STRIKE} />
        </div>
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Root
// ═══════════════════════════════════════════════════════════════════════════════

export default function DesignLab() {
  return (
    <div className={styles.lab}>
      <h1 className={styles.labTitle}>DESIGN LAB</h1>
      <p className={styles.labSubtitle}>
        VENUES ON OUTER EDGES · DATA CLUSTERED AROUND STRIKE CENTER
      </p>

      {/* V1 */}
      <section className={styles.variant}>
        <div className={styles.variantHeader}>
          <span className={styles.variantBadge}>V1</span>
          <span className={styles.variantName}>Full Spread</span>
          <span className={styles.variantDesc}>
            All columns explicit — venues flush to the edges, full greek columns, logo stack with
            best highlighted
          </span>
        </div>
        <V1 />
      </section>

      {/* V2 */}
      <section className={styles.variant}>
        <div className={styles.variantHeader}>
          <span className={styles.variantBadge}>V2</span>
          <span className={styles.variantName}>Tight Core</span>
          <span className={styles.variantDesc}>
            Greeks collapsed into a stacked group — delta prominent, γ and ν as subscript labels
            below
          </span>
        </div>
        <V2 />
      </section>

      {/* V3 */}
      <section className={styles.variant}>
        <div className={styles.variantHeader}>
          <span className={styles.variantBadge}>V3</span>
          <span className={styles.variantName}>Minimal Venues</span>
          <span className={styles.variantDesc}>
            Ultra-compact edge — only the best venue logo with a superscript count, maximum data
            density
          </span>
        </div>
        <V3 />
      </section>

      {/* V4 */}
      <section className={styles.variant}>
        <div className={styles.variantHeader}>
          <span className={styles.variantBadge}>V4</span>
          <span className={styles.variantName}>Edge Badges</span>
          <span className={styles.variantDesc}>
            Venue shortLabels as colored text tags on the far edges — best filled, others outlined
          </span>
        </div>
        <V4 />
      </section>

      {/* V5 */}
      <section className={styles.variant}>
        <div className={styles.variantHeader}>
          <span className={styles.variantBadge}>V5</span>
          <span className={styles.variantName}>Borderless Flow</span>
          <span className={styles.variantDesc}>
            No column borders — spacing creates separation, best venue row tinted, logos without
            rings
          </span>
        </div>
        <V5 />
      </section>
    </div>
  );
}

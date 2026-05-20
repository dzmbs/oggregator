import HoverTooltip from '@components/ui/HoverTooltip';
import styles from './RegimeChip.module.css';

type Tone = 'bull' | 'bear' | 'mixed' | 'neutral' | 'unknown';

interface RegimeChipProps {
  basisPct: number | null;
  skew25d: number | null;
  ivChange1d: number | null | undefined;
  putCallOiRatio: number | null;
}

const BASIS_FLAT = 0.01;
const SKEW_FLAT = 0.005;
const IV_FLAT = 0.002;
const PC_HIGH = 1.1;
const PC_LOW = 0.9;

type Sign3 = 'pos' | 'neg' | 'flat';
type PcBucket = 'high' | 'low' | 'flat';

function sign(value: number | null | undefined, flat: number): Sign3 | null {
  if (value == null) return null;
  if (Math.abs(value) < flat) return 'flat';
  return value > 0 ? 'pos' : 'neg';
}

function pcBucket(pc: number | null): PcBucket | null {
  if (pc == null) return null;
  if (pc > PC_HIGH) return 'high';
  if (pc < PC_LOW) return 'low';
  return 'flat';
}

// Labels describe what's measured (basis sign, skew sign, IV change sign, P/C
// bucket). Tones reflect commonly cited practitioner regimes from skew/IV
// literature and trader frameworks — they are heuristics, not signals. See
// tooltip footer for sourcing.

function basisSkewTone(b: Sign3 | null, s: Sign3 | null): { tone: Tone; label: string } {
  if (!b || !s) return { tone: 'unknown', label: 'No skew data' };
  if (b === 'flat' || s === 'flat') return { tone: 'neutral', label: 'Flat carry or flat skew' };
  if (b === 'pos' && s === 'pos') return { tone: 'bull', label: 'Contango + call-skew bid' };
  if (b === 'pos' && s === 'neg') return { tone: 'mixed', label: 'Contango + put-skew premium' };
  if (b === 'neg' && s === 'pos') return { tone: 'bull', label: 'Backwardation + call-skew bid' };
  return { tone: 'bear', label: 'Backwardation + put-skew premium' };
}

function basisIvTone(b: Sign3 | null, iv: Sign3 | null): { tone: Tone; label: string } {
  if (!b || !iv) return { tone: 'unknown', label: 'No IV Δ data' };
  if (b === 'flat') return { tone: 'neutral', label: 'Flat carry' };
  if (b === 'neg' && iv === 'pos') return { tone: 'bear', label: 'Backwardation + IV expanding' };
  if (b === 'neg' && (iv === 'neg' || iv === 'flat'))
    return { tone: 'mixed', label: 'Backwardation + IV calming' };
  if (b === 'pos' && (iv === 'neg' || iv === 'flat'))
    return { tone: 'bull', label: 'Contango + IV bleeding' };
  return { tone: 'mixed', label: 'Contango + IV expanding' };
}

function basisPcTone(b: Sign3 | null, pc: PcBucket | null): { tone: Tone; label: string } {
  if (!b || !pc) return { tone: 'unknown', label: 'No P/C data' };
  if (b === 'flat') return { tone: 'neutral', label: 'Flat carry' };
  if (b === 'neg' && pc === 'low') return { tone: 'bull', label: 'Backwardation + call-heavy OI' };
  if (b === 'pos' && pc === 'high') return { tone: 'bull', label: 'Contango + put-heavy OI' };
  if (b === 'pos' && pc === 'low') return { tone: 'bull', label: 'Contango + call-heavy OI' };
  if (b === 'neg' && pc === 'high') return { tone: 'bear', label: 'Backwardation + put-heavy OI' };
  return { tone: 'neutral', label: 'Balanced OI' };
}

export default function RegimeChip({
  basisPct,
  skew25d,
  ivChange1d,
  putCallOiRatio,
}: RegimeChipProps) {
  const b = sign(basisPct, BASIS_FLAT);
  const s = sign(skew25d, SKEW_FLAT);
  const iv = sign(ivChange1d, IV_FLAT);
  const pc = pcBucket(putCallOiRatio);

  const bs = basisSkewTone(b, s);
  const biv = basisIvTone(b, iv);
  const bpc = basisPcTone(b, pc);

  const tooltipContent = (
    <div className={styles.panel}>
      <div className={styles.tipHeader}>Cross-signal regime</div>

      <div className={styles.tipRow}>
        <span className={styles.tipBadge} data-tone={bs.tone} />
        <div>
          <div className={styles.tipPair}>Basis × 25Δ Skew</div>
          <div className={styles.tipNow}>{bs.label}</div>
        </div>
      </div>

      <div className={styles.tipRow}>
        <span className={styles.tipBadge} data-tone={biv.tone} />
        <div>
          <div className={styles.tipPair}>Basis × IV Δ1d</div>
          <div className={styles.tipNow}>{biv.label}</div>
        </div>
      </div>

      <div className={styles.tipRow}>
        <span className={styles.tipBadge} data-tone={bpc.tone} />
        <div>
          <div className={styles.tipPair}>Basis × P/C OI</div>
          <div className={styles.tipNow}>{bpc.label}</div>
        </div>
      </div>

      <div className={styles.tipDivider} />

      <div>
        <div className={styles.tipMatrixTitle}>Common heuristic reads</div>
        <ul className={styles.tipList}>
          <li>
            <strong>+B / −Skew</strong> — contango with crash premium → often called fragile rally
          </li>
          <li>
            <strong>−B / +Skew</strong> — backwardation with calls bid → often called turn / squeeze
          </li>
          <li>
            <strong>−B / +IV Δ</strong> — backwardation + IV expanding → active panic
          </li>
          <li>
            <strong>−B / flat IV</strong> — backwardation + IV calming → passive deleveraging
          </li>
          <li>
            <strong>+B / call-heavy OI</strong> — aligned bullish positioning
          </li>
          <li>
            <strong>−B / call-heavy OI</strong> — backwardation w/ no put demand → squeeze fuel
          </li>
          <li>
            <strong>−B / put-heavy OI</strong> — stress + downside hedged → capitulation watch
          </li>
        </ul>
        <div className={styles.tipLegend}>
          <span className={styles.tipBadge} data-tone="bull" /> bullish
          <span className={styles.tipBadge} data-tone="mixed" /> mixed
          <span className={styles.tipBadge} data-tone="bear" /> bearish
          <span className={styles.tipBadge} data-tone="neutral" /> neutral
        </div>
        <div className={styles.tipCaveat}>
          Heuristic reads from cost-of-carry theory, skew/IV literature (Bates,
          Black), and crypto practitioner frameworks (Deribit Insights, Block
          Scholes, Genesis Vol). Not investment signals — interpretation flips
          with retail vs. institutional flow.
        </div>
      </div>
    </div>
  );

  return (
    <HoverTooltip
      as="div"
      className={styles.cell}
      placement="bottom-end"
      content={tooltipContent}
    >
      <span className={styles.label}>Regime</span>
      <div className={styles.dots}>
        <span className={styles.dot} data-tone={bs.tone} aria-label={`Basis × Skew: ${bs.label}`} />
        <span className={styles.dot} data-tone={biv.tone} aria-label={`Basis × IV Δ1d: ${biv.label}`} />
        <span className={styles.dot} data-tone={bpc.tone} aria-label={`Basis × P/C OI: ${bpc.label}`} />
      </div>
      <span className={styles.sub}>B×S · B×IV · B×OI</span>
    </HoverTooltip>
  );
}

import deribitLogo from '@/assets/venues/deribit.svg';
import okxLogo from '@/assets/venues/okx.png';
import binanceLogo from '@/assets/venues/binance.svg';
import bybitLogo from '@/assets/venues/bybit.svg';
import deriveLogo from '@/assets/venues/derive.png';
import coincallLogo from '@/assets/venues/coincall.png';
import thalexLogo from '@/assets/venues/Thalex.svg';
import gateioLogo from '@/assets/venues/gateio.svg';

export interface VenueMeta {
  id: string;
  label: string;
  shortLabel: string;
  logo: string;
  color: string;
}

export const VENUES: Record<string, VenueMeta> = {
  deribit: {
    id: 'deribit',
    label: 'Deribit',
    shortLabel: 'DER',
    logo: deribitLogo,
    color: '#0052FF',
  },
  okx: { id: 'okx', label: 'OKX', shortLabel: 'OKX', logo: okxLogo, color: '#888888' },
  binance: {
    id: 'binance',
    label: 'Binance',
    shortLabel: 'BIN',
    logo: binanceLogo,
    color: '#F0B90B',
  },
  bybit: { id: 'bybit', label: 'Bybit', shortLabel: 'BYB', logo: bybitLogo, color: '#F7A600' },
  derive: { id: 'derive', label: 'Derive', shortLabel: 'DRV', logo: deriveLogo, color: '#25FAAF' },
  coincall: {
    id: 'coincall',
    label: 'Coincall',
    shortLabel: 'CCL',
    logo: coincallLogo,
    color: '#1FE086',
  },
  thalex: {
    id: 'thalex',
    label: 'Thalex',
    shortLabel: 'THX',
    logo: thalexLogo,
    color: '#00E5A8',
  },
  gateio: {
    id: 'gateio',
    label: 'Gate.io',
    shortLabel: 'GAT',
    logo: gateioLogo,
    color: '#2354E6',
  },
};

export const VENUE_LIST = Object.values(VENUES);
export const VENUE_IDS = Object.keys(VENUES);

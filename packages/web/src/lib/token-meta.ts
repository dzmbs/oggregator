import btcLogo from '@/assets/tokens/btc.svg';
import ethLogo from '@/assets/tokens/eth.svg';
import solLogo from '@/assets/tokens/sol.svg';
import avaxLogo from '@/assets/tokens/avax.svg';
import bnbLogo from '@/assets/tokens/bnb.svg';
import xrpLogo from '@/assets/tokens/xrp.svg';
import dogeLogo from '@/assets/tokens/doge.svg';
import trxLogo from '@/assets/tokens/trx.svg';
import hypeLogo from '@/assets/tokens/hype.svg';
import ltcLogo from '@/assets/tokens/ltc.svg';
import suiLogo from '@/assets/tokens/sui.svg';
import xautLogo from '@/assets/tokens/xaut.svg';
import aaveLogo from '@/assets/tokens/aave.svg';
import maticLogo from '@/assets/tokens/matic.svg';
import ordiLogo from '@/assets/tokens/ordi.svg';
import mntLogo from '@/assets/tokens/mnt.svg';
import pendleLogo from '@/assets/tokens/pendle.svg';
import litLogo from '@/assets/tokens/lit.svg';
import kasLogo from '@/assets/tokens/kas.svg';
import adaLogo from '@/assets/tokens/ada.svg';
import tonLogo from '@/assets/tokens/ton.svg';
import trumpLogo from '@/assets/tokens/trump.png';
import xtiLogo from '@/assets/tokens/xti.svg';
import enaLogo from '@/assets/tokens/ena.svg';

export interface TokenMeta {
  symbol: string;
  name: string;
  logo: string;
}

const TOKEN_MAP: Record<string, TokenMeta> = {
  BTC: { symbol: 'BTC', name: 'Bitcoin', logo: btcLogo },
  ETH: { symbol: 'ETH', name: 'Ethereum', logo: ethLogo },
  SOL: { symbol: 'SOL', name: 'Solana', logo: solLogo },
  AVAX: { symbol: 'AVAX', name: 'Avalanche', logo: avaxLogo },
  BNB: { symbol: 'BNB', name: 'BNB', logo: bnbLogo },
  XRP: { symbol: 'XRP', name: 'XRP', logo: xrpLogo },
  DOGE: { symbol: 'DOGE', name: 'Dogecoin', logo: dogeLogo },
  TRX: { symbol: 'TRX', name: 'Tron', logo: trxLogo },
  HYPE: { symbol: 'HYPE', name: 'Hyperliquid', logo: hypeLogo },
  LTC: { symbol: 'LTC', name: 'Litecoin', logo: ltcLogo },
  SUI: { symbol: 'SUI', name: 'Sui', logo: suiLogo },
  XAUT: { symbol: 'XAUT', name: 'Tether Gold', logo: xautLogo },
  AAVE: { symbol: 'AAVE', name: 'Aave', logo: aaveLogo },
  MATIC: { symbol: 'MATIC', name: 'Polygon', logo: maticLogo },
  POL: { symbol: 'POL', name: 'Polygon', logo: maticLogo },
  ORDI: { symbol: 'ORDI', name: 'Ordinals', logo: ordiLogo },
  MNT: { symbol: 'MNT', name: 'Mantle', logo: mntLogo },
  PENDLE: { symbol: 'PENDLE', name: 'Pendle', logo: pendleLogo },
  LIT: { symbol: 'LIT', name: 'Litentry', logo: litLogo },
  KAS: { symbol: 'KAS', name: 'Kaspa', logo: kasLogo },
  ADA: { symbol: 'ADA', name: 'Cardano', logo: adaLogo },
  TON: { symbol: 'TON', name: 'Toncoin', logo: tonLogo },
  TRUMP: { symbol: 'TRUMP', name: 'Official Trump', logo: trumpLogo },
  XTI: { symbol: 'XTI', name: 'WTI Crude Oil', logo: xtiLogo },
  ENA: { symbol: 'ENA', name: 'Ethena', logo: enaLogo },
};

export function getTokenMeta(symbol: string): TokenMeta | undefined {
  const upper = symbol.toUpperCase();
  return TOKEN_MAP[upper] ?? TOKEN_MAP[upper.split('_')[0]!];
}

export function getTokenLogo(symbol: string): string | undefined {
  // Try exact match first, then extract base from "BTC_USDC" → "BTC"
  const upper = symbol.toUpperCase();
  return TOKEN_MAP[upper]?.logo ?? TOKEN_MAP[upper.split('_')[0]!]?.logo;
}

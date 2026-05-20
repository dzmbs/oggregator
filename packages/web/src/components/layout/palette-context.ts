import { createContext, useContext } from 'react';

export const PaletteContext = createContext<() => void>(() => {});

export function useOpenPalette() {
  return useContext(PaletteContext);
}

import React, { createContext, useContext, useEffect, useState } from 'react';

const ThemeContext = createContext(null);

export const FONT_LEVELS = [
  { key: 'standard', label: '标准' },
  { key: 'large', label: '大' },
  { key: 'xlarge', label: '特大' }
];

export function ThemeProvider({ children }) {
  const [fontSize, setFontSize] = useState(() => {
    try { return localStorage.getItem('lp.fontSize') || 'standard'; } catch { return 'standard'; }
  });
  const [dark, setDark] = useState(() => {
    try { return localStorage.getItem('lp.dark') === '1'; } catch { return false; }
  });

  useEffect(() => {
    document.documentElement.dataset.font = fontSize;
    try { localStorage.setItem('lp.fontSize', fontSize); } catch { /* ignore */ }
  }, [fontSize]);

  useEffect(() => {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    document.body.classList.toggle('semi-dark', dark);
    try { localStorage.setItem('lp.dark', dark ? '1' : '0'); } catch { /* ignore */ }
  }, [dark]);

  const value = { fontSize, setFontSize, dark, setDark };
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  return useContext(ThemeContext);
}

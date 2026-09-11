import React from 'react';
import { createRoot } from 'react-dom/client';
// 副作用导入：执行 video-call-media-adapter 以设置 window.LongPetVideoCallMediaAdapter（与旧版一致，须在 App 之前）
import '../video-call-media-adapter.js';
import '../vision-monitor-adapter.js';
import '../motion-control-adapter.js';
import '@semi-css';
import './theme.css';
import './styles.css';
import { ThemeProvider } from './theme/ThemeContext';
import App from './App';

createRoot(document.getElementById('root')).render(
  <ThemeProvider>
    <App />
  </ThemeProvider>
);

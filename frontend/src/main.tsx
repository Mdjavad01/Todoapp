import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles/global.css';
import { useAppStore } from './store/useAppStore';
import { registerServiceWorker } from './pwa/register';
import { initKeyboardAwareness } from './lib/keyboard';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

void useAppStore.getState().init();
registerServiceWorker();
// مکانیزم جهانی کیبورد — پنجره‌های پایین‌چسب هرگز زیر کیبورد نروند (v15)
initKeyboardAwareness();

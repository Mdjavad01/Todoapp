import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles/global.css';
import { useAppStore } from './store/useAppStore';
import { registerServiceWorker } from './pwa/register';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

void useAppStore.getState().init();
registerServiceWorker();

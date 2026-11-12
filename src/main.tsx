import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
    // Warm the cache with the 7MB engine so hints and the bot are instant (and work offline) later.
    setTimeout(() => fetch('/engine/stockfish-18-lite-single.wasm').catch(() => {}), 2500);
  });
}

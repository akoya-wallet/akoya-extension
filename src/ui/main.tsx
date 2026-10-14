import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { isPopup } from '../ext/platform.ts';
import './styles.css';

if (!isPopup()) document.body.classList.add('tab');
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.tsx';
import { PortalResidente } from './views/PortalResidente.tsx';

const path = window.location.pathname;
const payMatch = path.match(/^\/pagar\/([^/]+)\/?$/);
const portalMatch = path.match(/^\/portal\/([^/]+)\/?$/);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {payMatch ? (
      <PortalResidente initialToken={decodeURIComponent(payMatch[1])} />
    ) : portalMatch ? (
      <PortalResidente companySlug={decodeURIComponent(portalMatch[1])} />
    ) : (
      <App />
    )}
  </StrictMode>,
);

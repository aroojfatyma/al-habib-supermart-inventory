import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { seedPakistaniInventoryMerge } from './db'

void seedPakistaniInventoryMerge().catch(() => {
  /* ignore seed errors (e.g. private browsing) */
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

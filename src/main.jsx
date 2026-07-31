import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { AppRouter } from './AppRouter.jsx'
import { registerSW } from 'virtual:pwa-register'

const updateSW = registerSW({
  immediate: true,
})

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <AppRouter />
  </StrictMode>,
)

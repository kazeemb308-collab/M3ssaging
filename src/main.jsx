import { Suspense, lazy, StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'

const AppRouter = lazy(() => import('./AppRouter.jsx').then((module) => ({ default: module.AppRouter })))

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Suspense fallback={<div className="app-shell">Loading...</div>}>
      <AppRouter />
    </Suspense>
  </StrictMode>,
)

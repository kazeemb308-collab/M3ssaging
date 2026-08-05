import { Suspense, lazy, StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { registerSW } from 'virtual:pwa-register'

const AppRouter = lazy(() => import('./AppRouter.jsx').then((module) => ({ default: module.AppRouter })))

async function unregisterStaleServiceWorkers() {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
    return
  }

  const registrations = await navigator.serviceWorker.getRegistrations()
  await Promise.all(registrations.map((registration) => registration.unregister()))
}

void unregisterStaleServiceWorkers()

const updateSW = registerSW({
  immediate: false,
})

if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
  window.requestIdleCallback(() => {
    updateSW()
  })
} else {
  window.setTimeout(() => {
    updateSW()
  }, 1500)
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Suspense fallback={<div className="app-shell">Loading...</div>}>
      <AppRouter />
    </Suspense>
  </StrictMode>,
)

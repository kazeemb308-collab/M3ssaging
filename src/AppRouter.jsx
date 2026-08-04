import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { firebaseReady, loadFirebaseServices } from './firebase'
import App from './App'

function AuthGate({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    let unsubscribeAuth = null
    let fallbackTimer = null

    const finishFallback = () => {
      if (!cancelled) {
        setUser({ uid: 'demo-user' })
        setLoading(false)
      }
    }

    const initializeAuth = async () => {
      if (!firebaseReady) {
        finishFallback()
        return
      }

      try {
        const { auth } = await loadFirebaseServices()
        if (!auth || cancelled) {
          finishFallback()
          return
        }

        fallbackTimer = window.setTimeout(() => {
          finishFallback()
        }, 2500)

        const { onAuthStateChanged, signInAnonymously } = await import('firebase/auth')
        unsubscribeAuth = onAuthStateChanged(auth, (currentUser) => {
          if (cancelled) {
            return
          }

          if (fallbackTimer) {
            window.clearTimeout(fallbackTimer)
            fallbackTimer = null
          }

          if (currentUser) {
            setUser(currentUser)
            setLoading(false)
            return
          }

          signInAnonymously(auth).catch(() => {
            finishFallback()
          })
        })
      } catch {
        finishFallback()
      }
    }

    void initializeAuth()

    return () => {
      cancelled = true
      unsubscribeAuth?.()
      if (fallbackTimer) {
        window.clearTimeout(fallbackTimer)
      }
    }
  }, [])

  if (loading) {
    return <div className="loading-screen">Connecting your private chat...</div>
  }

  return children
}

function AppRouter() {
  return (
    <BrowserRouter>
      <AuthGate>
        <Routes>
          <Route path="/" element={<App />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthGate>
    </BrowserRouter>
  )
}

export { AppRouter }

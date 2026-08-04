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

    const initializeAuth = async () => {
      if (!firebaseReady) {
        if (!cancelled) {
          setUser({ uid: 'demo-user' })
          setLoading(false)
        }
        return
      }

      const { auth } = await loadFirebaseServices()
      if (!auth || cancelled) {
        return
      }

      const { onAuthStateChanged, signInAnonymously } = await import('firebase/auth')
      unsubscribeAuth = onAuthStateChanged(auth, (currentUser) => {
        if (cancelled) {
          return
        }

        setUser(currentUser)
        setLoading(false)
      })

      if (!user) {
        signInAnonymously(auth).catch(() => {
          if (!cancelled) {
            setUser({ uid: 'demo-user' })
            setLoading(false)
          }
        })
      }
    }

    void initializeAuth()

    return () => {
      cancelled = true
      unsubscribeAuth?.()
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

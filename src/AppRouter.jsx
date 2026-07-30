import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { onAuthStateChanged, signInAnonymously, signOut as firebaseSignOut } from 'firebase/auth'
import { auth, firebaseReady } from './firebase'
import App from './App'

function AuthGate({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!auth || !firebaseReady) {
      setUser({ uid: 'demo-user' })
      setLoading(false)
      return
    }

    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser)
      setLoading(false)
    })

    return () => unsubscribe()
  }, [])

  useEffect(() => {
    if (!auth || !firebaseReady || user) {
      return
    }

    signInAnonymously(auth)
      .catch(() => {
        setUser({ uid: 'demo-user' })
        setLoading(false)
      })
  }, [auth, firebaseReady, user])

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

export { AppRouter, firebaseSignOut }

import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { onAuthStateChanged, signInAnonymously, signOut as firebaseSignOut } from 'firebase/auth'
import { auth } from './firebase'
import App from './App'

function AuthGate({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!auth) {
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
    if (!auth || user) {
      return
    }

    signInAnonymously(auth).catch(() => {})
  }, [auth, user])

  if (loading) {
    return <div className="loading-screen">Connecting your private chat...</div>
  }

  if (!user) {
    return <div className="loading-screen">Preparing secure sign-in...</div>
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

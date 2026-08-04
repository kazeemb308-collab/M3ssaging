import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import App from './App'

function AuthGate({ children }) {
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

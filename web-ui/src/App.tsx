import { BrowserRouter, Routes, Route } from 'react-router-dom'
import Landing from './pages/Landing'
import Dashboard from './pages/Dashboard'
import AuthPopup from './pages/AuthPopup'

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/auth-popup/:requestId" element={<AuthPopup />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App

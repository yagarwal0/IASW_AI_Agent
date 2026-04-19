import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom'
import IntakeForm from './components/IntakeForm.jsx'
import CheckerDashboard from './components/CheckerDashboard.jsx'
import RequestDetail from './components/RequestDetail.jsx'
import AuditLog from './components/AuditLog.jsx'

export default function App() {
  return (
    <BrowserRouter>
      <nav className="navbar">
        <div className="navbar-brand">
          <span className="navbar-logo">🏦</span>
          <span className="navbar-title">IASW</span>
          <span className="navbar-subtitle">Intelligent Account Servicing Workflow</span>
        </div>
        <div className="navbar-links">
          <NavLink to="/" end className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}>
            Staff Intake
          </NavLink>
          <NavLink to="/checker" className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}>
            Checker Dashboard
          </NavLink>
          <NavLink to="/audit" className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}>
            Audit Log
          </NavLink>
        </div>
      </nav>
      <main className="main-content">
        <Routes>
          <Route path="/" element={<IntakeForm />} />
          <Route path="/checker" element={<CheckerDashboard />} />
          <Route path="/checker/:requestId" element={<RequestDetail />} />
          <Route path="/audit" element={<AuditLog />} />
        </Routes>
      </main>
    </BrowserRouter>
  )
}

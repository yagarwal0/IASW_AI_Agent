import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import axios from 'axios'

const API_BASE = 'http://localhost:8000'
const REFRESH_INTERVAL = 30000

function confidenceClass(pct) {
  if (pct >= 80) return 'high'
  if (pct >= 60) return 'medium'
  return 'low'
}

function StatusBadge({ status }) {
  if (!status) return <span className="badge badge-pending">Unknown</span>
  const s = status.toUpperCase()
  if (s.includes('APPROVED') || s === 'APPROVED')
    return <span className="badge badge-approved">✓ Approved</span>
  if (s.includes('REJECT'))
    return <span className="badge badge-rejected">✕ Rejected</span>
  if (s.includes('PENDING') && s.includes('HUMAN'))
    return <span className="badge badge-ai-verified">⏳ Pending Review</span>
  if (s.includes('PENDING'))
    return <span className="badge badge-pending">⏳ Pending</span>
  if (s.includes('PROCESSING') || s.includes('VERIF'))
    return <span className="badge badge-processing">⚙ Processing</span>
  return <span className="badge badge-pending">{status}</span>
}

function ForgeryBadge({ result }) {
  if (!result) return <span style={{ color: 'var(--gray-400)', fontSize: '0.8rem' }}>—</span>
  const r = result.toUpperCase()
  if (r === 'CLEAN') return <span style={{ color: 'var(--green)', fontWeight: 700, fontSize: '0.82rem' }}>🛡️ Clean</span>
  if (r === 'SUSPECT') return <span style={{ color: 'var(--red)', fontWeight: 700, fontSize: '0.82rem' }}>🚨 Suspect</span>
  return <span style={{ color: 'var(--yellow)', fontWeight: 700, fontSize: '0.82rem' }}>⚠️ {result}</span>
}

function SkeletonRows({ n = 5 }) {
  return Array.from({ length: n }).map((_, i) => (
    <tr key={i} className="loading-row">
      <td colSpan={8}>
        <div className="skeleton-row">
          {Array.from({ length: 8 }).map((_, j) => (
            <div key={j} className="skeleton" style={{ height: 14 }} />
          ))}
        </div>
      </td>
    </tr>
  ))
}

function formatDate(str) {
  if (!str) return '—'
  try {
    return new Date(str).toLocaleString(undefined, {
      month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    })
  } catch {
    return str
  }
}

function truncate(str, n = 12) {
  if (!str) return '—'
  return str.length > n ? str.slice(0, n) + '…' : str
}

const TABS = [
  { label: 'All',      value: '' },
  { label: 'Pending',  value: 'AI_VERIFIED_PENDING_HUMAN' },
  { label: 'Approved', value: 'APPROVED' },
  { label: 'Rejected', value: 'REJECTED' },
]

export default function CheckerDashboard() {
  const [requests, setRequests] = useState([])
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState(null)
  const [activeTab, setActiveTab] = useState('')
  const [lastRefresh, setLastRefresh] = useState(null)
  const navigate = useNavigate()

  const fetchRequests = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    setError(null)
    try {
      const params = activeTab ? { status: activeTab } : {}
      const res = await axios.get(`${API_BASE}/api/requests`, { params })
      // handle both array response and { requests: [] }
      const data = Array.isArray(res.data)
        ? res.data
        : Array.isArray(res.data?.requests)
          ? res.data.requests
          : []
      setRequests(data)
      setLastRefresh(new Date())
    } catch (err) {
      setError(
        err.response?.data?.detail ||
        err.response?.data?.message ||
        err.message ||
        'Failed to load requests.'
      )
    } finally {
      setLoading(false)
    }
  }, [activeTab])

  // Initial + tab-change fetch
  useEffect(() => {
    fetchRequests(false)
  }, [fetchRequests])

  // Auto-refresh
  useEffect(() => {
    const id = setInterval(() => fetchRequests(true), REFRESH_INTERVAL)
    return () => clearInterval(id)
  }, [fetchRequests])

  // Count per tab
  function countForTab(tab) {
    if (!tab) return requests.length
    return requests.filter(r => r.status === tab || r.status?.toUpperCase() === tab.toUpperCase()).length
  }

  // For the "All" tab we show all; otherwise filter client-side for responsiveness
  const displayed = activeTab
    ? requests.filter(r => {
        const s = (r.status ?? '').toUpperCase()
        return s === activeTab.toUpperCase() || s.includes(activeTab.toUpperCase().split('_')[0])
      })
    : requests

  return (
    <div>
      <div className="page-header" style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between' }}>
        <div>
          <h1 className="page-title">
            <span>🔍</span> Checker Dashboard
          </h1>
          <p className="page-subtitle">
            Review AI-analysed change requests and approve or reject them
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {lastRefresh && (
            <div className="refresh-info">
              <span className="refresh-dot" />
              Refreshes every 30s · Last: {lastRefresh.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </div>
          )}
          <button
            className="btn-secondary btn-sm"
            onClick={() => fetchRequests(false)}
            disabled={loading}
          >
            {loading ? <span className="spinner spinner-dark" /> : '↺'} Refresh
          </button>
        </div>
      </div>

      {/* Summary stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 24 }}>
        {[
          { label: 'Total Requests', count: requests.length, icon: '📁', color: 'var(--navy)' },
          { label: 'Pending Review', count: requests.filter(r => r.status?.toUpperCase().includes('PENDING')).length, icon: '⏳', color: '#ca8a04' },
          { label: 'Approved', count: requests.filter(r => r.status?.toUpperCase().includes('APPROVED')).length, icon: '✅', color: 'var(--green)' },
          { label: 'Rejected', count: requests.filter(r => r.status?.toUpperCase().includes('REJECT')).length, icon: '❌', color: 'var(--red)' },
        ].map(stat => (
          <div key={stat.label} className="card" style={{ padding: '16px 20px', margin: 0, display: 'flex', alignItems: 'center', gap: 14 }}>
            <span style={{ fontSize: '1.6rem' }}>{stat.icon}</span>
            <div>
              <div style={{ fontSize: '1.6rem', fontWeight: 900, color: stat.color, lineHeight: 1.1 }}>{stat.count}</div>
              <div style={{ fontSize: '0.75rem', color: 'var(--gray-600)', fontWeight: 600, marginTop: 2 }}>{stat.label}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Filter tabs */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <div className="filter-tabs">
          {TABS.map(tab => (
            <button
              key={tab.value}
              className={`filter-tab ${activeTab === tab.value ? 'active' : ''}`}
              onClick={() => setActiveTab(tab.value)}
            >
              {tab.label}
              <span className="tab-count">{countForTab(tab.value)}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="alert alert-error" style={{ marginBottom: 16 }}>
          <span className="alert-icon">⚠️</span>
          <div>{error}</div>
        </div>
      )}

      {/* Table */}
      <div className="table-container">
        <table>
          <thead>
            <tr>
              <th>Request ID</th>
              <th>Customer ID</th>
              <th>Change Type</th>
              <th>Confidence</th>
              <th>Forgery Check</th>
              <th>Status</th>
              <th>Submitted</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <SkeletonRows n={6} />
            ) : displayed.length === 0 ? (
              <tr>
                <td colSpan={8}>
                  <div className="empty-state">
                    <span className="empty-state-icon">📭</span>
                    <div className="empty-state-title">No requests found</div>
                    <div className="empty-state-text">
                      {activeTab ? `No ${activeTab.toLowerCase().replace(/_/g, ' ')} requests at this time.` : 'Submit a new request via the Staff Intake form.'}
                    </div>
                  </div>
                </td>
              </tr>
            ) : (
              displayed.map(req => {
                const conf = req.score_card?.overall_confidence_pct ?? req.confidence_pct ?? null
                const forgery = req.score_card?.forgery_check?.result ?? req.forgery_result ?? null
                const cc = conf != null ? confidenceClass(conf) : null

                return (
                  <tr key={req.request_id}>
                    <td>
                      <span className="td-mono" title={req.request_id}>
                        {truncate(req.request_id, 14)}
                      </span>
                    </td>
                    <td>
                      <span style={{ fontWeight: 600, color: 'var(--navy)' }}>{req.customer_id ?? '—'}</span>
                    </td>
                    <td>
                      <span style={{
                        background: 'var(--blue-light)', color: 'var(--blue)',
                        padding: '2px 9px', borderRadius: '999px',
                        fontSize: '0.75rem', fontWeight: 700,
                        textTransform: 'uppercase', letterSpacing: '0.04em'
                      }}>
                        {(req.change_type ?? '—').replace(/_/g, ' ')}
                      </span>
                    </td>
                    <td>
                      {conf != null ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 120 }}>
                          <div style={{ flex: 1, height: 6, background: 'var(--gray-100)', borderRadius: '999px', overflow: 'hidden' }}>
                            <div
                              className={`confidence-bar-fill ${cc}`}
                              style={{ width: `${conf}%`, height: '100%' }}
                            />
                          </div>
                          <span className={`confidence-value ${cc}`} style={{ minWidth: 36 }}>{conf}%</span>
                        </div>
                      ) : (
                        <span style={{ color: 'var(--gray-400)', fontSize: '0.8rem' }}>—</span>
                      )}
                    </td>
                    <td><ForgeryBadge result={forgery} /></td>
                    <td><StatusBadge status={req.status} /></td>
                    <td>
                      <span style={{ fontSize: '0.82rem', color: 'var(--gray-600)' }}>
                        {formatDate(req.created_at ?? req.submitted_at)}
                      </span>
                    </td>
                    <td>
                      <button
                        className="btn-primary btn-sm"
                        onClick={() => navigate(`/checker/${req.request_id}`)}
                      >
                        Review →
                      </button>
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>

      <div style={{ marginTop: 12, fontSize: '0.78rem', color: 'var(--gray-400)', textAlign: 'right' }}>
        {displayed.length} record{displayed.length !== 1 ? 's' : ''} shown
      </div>
    </div>
  )
}

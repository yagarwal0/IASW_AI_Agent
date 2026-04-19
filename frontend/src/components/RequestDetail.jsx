import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import axios from 'axios'

const API_BASE = 'http://localhost:8000'
const CHECKER_ID = 'CHECKER_001'

/* ---- Helpers ---- */
function confidenceClass(pct) {
  if (pct >= 80) return 'high'
  if (pct >= 60) return 'medium'
  return 'low'
}

function formatDate(str) {
  if (!str) return '—'
  try {
    return new Date(str).toLocaleString(undefined, {
      year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    })
  } catch {
    return str
  }
}

function StatusBadge({ status }) {
  if (!status) return <span className="badge badge-pending">Unknown</span>
  const s = status.toUpperCase()
  if (s.includes('APPROVED')) return <span className="badge badge-approved">✓ Approved</span>
  if (s.includes('REJECT'))   return <span className="badge badge-rejected">✕ Rejected</span>
  if (s.includes('PENDING') && s.includes('HUMAN'))
    return <span className="badge badge-ai-verified">⏳ Pending Review</span>
  if (s.includes('PENDING'))  return <span className="badge badge-pending">⏳ Pending</span>
  if (s.includes('PROCESSING') || s.includes('VERIF'))
    return <span className="badge badge-processing">⚙ Processing</span>
  return <span className="badge badge-pending">{status}</span>
}

function RecommendationBadge({ rec }) {
  if (!rec) return null
  const r = rec.toUpperCase()
  if (r === 'APPROVE') return <span className="badge badge-approve">✓ Approve</span>
  if (r === 'REJECT')  return <span className="badge badge-reject">✕ Reject</span>
  return <span className="badge badge-review">⚠ {rec}</span>
}

/* ---- Sub-components ---- */
function SectionCard({ title, icon, children, style }) {
  return (
    <div className="card" style={style}>
      <div className="card-header">
        <div className="card-title">
          <span className="card-title-icon">{icon}</span>
          {title}
        </div>
      </div>
      {children}
    </div>
  )
}

function ConfidenceDisplay({ score }) {
  const overall = score?.overall_confidence ?? score?.overall_confidence_pct ?? 0
  const cc = confidenceClass(overall)
  const fields = score?.field_scores ?? []
  const forgery = score?.forgery_check ?? {}

  return (
    <>
      {/* Big number */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 32, marginBottom: 24 }}>
        <div className="confidence-big">
          <div className={`confidence-big-number ${cc}`}>{overall}%</div>
          <div className="confidence-big-label">Overall Confidence</div>
        </div>
        <div style={{ flex: 1 }}>
          <div className="confidence-bar-container" style={{ marginBottom: 8 }}>
            <div className="confidence-bar" style={{ flex: 1 }}>
              <div className={`confidence-bar-fill ${cc}`} style={{ width: `${overall}%` }} />
            </div>
            <span className={`confidence-value ${cc}`}>{overall}%</span>
          </div>
          <div style={{ fontSize: '0.8rem', color: 'var(--gray-600)' }}>
            {cc === 'high' && '✅ High confidence — AI recommends approval'}
            {cc === 'medium' && '⚠️ Moderate confidence — careful review advised'}
            {cc === 'low' && '🚨 Low confidence — manual verification required'}
          </div>
        </div>
      </div>

      {/* Field score rows */}
      {fields.length > 0 && (
        <div>
          <div className="score-row-header">
            <span>Field</span>
            <span>Extracted Value</span>
            <span>Requested Value</span>
            <span style={{ textAlign: 'center' }}>Score</span>
            <span>Status</span>
          </div>
          {fields.map((f, i) => {
            const st = (f.status ?? 'UNKNOWN').toLowerCase()
            return (
              <div key={i} className={`score-row ${st}`}>
                <span className="score-field-name">{f.field_name}</span>
                <span className="score-field-value">{f.extracted_value ?? '—'}</span>
                <span className="score-field-value">{f.requested_value ?? '—'}</span>
                <span className={`score-pct ${st}`}>{f.score_pct ?? 0}%</span>
                <span>
                  <span className={`status-dot ${st}`} />
                  {f.status}
                </span>
              </div>
            )
          })}
        </div>
      )}

      {/* Forgery */}
      {forgery?.result && (
        <div style={{ marginTop: 16 }}>
          <div style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--gray-600)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
            Document Forgery Check
          </div>
          <div className={`forgery-result ${forgery.result === 'CLEAN' ? 'clean' : forgery.result === 'SUSPECT' ? 'suspect' : 'warning'}`}>
            <span className="forgery-icon">
              {forgery.result === 'CLEAN' ? '🛡️' : forgery.result === 'SUSPECT' ? '🚨' : '⚠️'}
            </span>
            <span style={{ fontWeight: 700 }}>{forgery.result}</span>
            {forgery.confidence_pct != null && (
              <span style={{ marginLeft: 8, fontWeight: 400, fontSize: '0.85rem' }}>
                ({forgery.confidence_pct}% confidence)
              </span>
            )}
            {forgery.analysis && (
              <span style={{ marginLeft: 8, fontWeight: 400, fontSize: '0.85rem', opacity: 0.85 }}>
                — {forgery.analysis}
              </span>
            )}
          </div>
          {forgery.indicators && forgery.indicators.length > 0 && (
            <ul className="forgery-indicators">
              {forgery.indicators.map((ind, i) => <li key={i}>{ind}</li>)}
            </ul>
          )}
        </div>
      )}
    </>
  )
}

function ExtractedData({ data }) {
  if (!data || typeof data !== 'object') return <p className="text-muted text-sm">No extracted data available.</p>

  const entries = Object.entries(data).filter(([k]) => !k.startsWith('_'))
  if (entries.length === 0) return <p className="text-muted text-sm">No extracted fields.</p>

  return (
    <div className="kv-grid">
      {entries.map(([key, val]) => (
        <div key={key} className="kv-item">
          <span className="kv-label">{key.replace(/_/g, ' ')}</span>
          <span className="kv-value">
            {val === null || val === undefined ? '—' : String(val)}
          </span>
        </div>
      ))}
    </div>
  )
}

function ActionPanel({ request, onActionComplete }) {
  const [showRejectInput, setShowRejectInput] = useState(false)
  const [rejectReason, setRejectReason] = useState('')
  const [confirming, setConfirming] = useState(null) // 'approve' | 'reject'
  const [loading, setLoading] = useState(false)
  const [actionResult, setActionResult] = useState(null)
  const [actionError, setActionError] = useState(null)

  const status = (request?.status ?? '').toUpperCase()
  const isPending = status.includes('PENDING')

  // Already decided
  if (!isPending) {
    const isApproved = status.includes('APPROVED')
    const isRejected = status.includes('REJECT')
    return (
      <div>
        {isApproved && (
          <div className="decision-banner approved">
            <span className="decision-banner-icon">✅</span>
            <div>
              <div className="decision-banner-title">This request has been APPROVED</div>
              <div className="decision-banner-meta">
                {request.checker_id && <span>Checker: {request.checker_id} · </span>}
                {request.decided_at && <span>{formatDate(request.decided_at)}</span>}
                {request.rps_transaction_id && (
                  <div style={{ marginTop: 4, fontFamily: 'monospace', fontSize: '0.82rem', color: 'var(--green)' }}>
                    RPS Transaction: {request.rps_transaction_id}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
        {isRejected && (
          <div className="decision-banner rejected">
            <span className="decision-banner-icon">❌</span>
            <div>
              <div className="decision-banner-title">This request has been REJECTED</div>
              <div className="decision-banner-meta">
                {request.checker_id && <span>Checker: {request.checker_id} · </span>}
                {request.decided_at && <span>{formatDate(request.decided_at)}</span>}
                {request.rejection_reason && (
                  <div style={{ marginTop: 4 }}>Reason: {request.rejection_reason}</div>
                )}
              </div>
            </div>
          </div>
        )}
        {!isApproved && !isRejected && (
          <div className="alert alert-info">
            <span className="alert-icon">ℹ️</span>
            <div>This request is in status: <strong>{request.status}</strong></div>
          </div>
        )}
      </div>
    )
  }

  async function doApprove() {
    setLoading(true)
    setActionError(null)
    try {
      const res = await axios.post(
        `${API_BASE}/api/requests/${request.request_id}/approve?checker_id=${CHECKER_ID}`
      )
      setActionResult({ type: 'approved', data: res.data })
      onActionComplete?.()
    } catch (err) {
      setActionError(
        err.response?.data?.detail ||
        err.response?.data?.message ||
        err.message ||
        'Approval failed.'
      )
    } finally {
      setLoading(false)
      setConfirming(null)
    }
  }

  async function doReject() {
    if (!rejectReason.trim()) {
      setActionError('Please provide a reason for rejection.')
      return
    }
    setLoading(true)
    setActionError(null)
    try {
      const encodedReason = encodeURIComponent(rejectReason.trim())
      const res = await axios.post(
        `${API_BASE}/api/requests/${request.request_id}/reject?checker_id=${CHECKER_ID}&reason=${encodedReason}`
      )
      setActionResult({ type: 'rejected', data: res.data })
      onActionComplete?.()
    } catch (err) {
      setActionError(
        err.response?.data?.detail ||
        err.response?.data?.message ||
        err.message ||
        'Rejection failed.'
      )
    } finally {
      setLoading(false)
      setConfirming(null)
    }
  }

  // Post-action result
  if (actionResult) {
    return (
      <div>
        {actionResult.type === 'approved' ? (
          <div className="decision-banner approved">
            <span className="decision-banner-icon">✅</span>
            <div>
              <div className="decision-banner-title">Request Approved Successfully</div>
              <div className="decision-banner-meta">
                Checker: {CHECKER_ID} · {formatDate(new Date().toISOString())}
                {actionResult.data?.rps_transaction_id && (
                  <div style={{ marginTop: 4, fontFamily: 'monospace', fontSize: '0.82rem', color: 'var(--green)' }}>
                    RPS Transaction ID: {actionResult.data.rps_transaction_id}
                  </div>
                )}
                {actionResult.data?.message && (
                  <div style={{ marginTop: 6, fontSize: '0.85rem' }}>{actionResult.data.message}</div>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="decision-banner rejected">
            <span className="decision-banner-icon">❌</span>
            <div>
              <div className="decision-banner-title">Request Rejected</div>
              <div className="decision-banner-meta">
                Checker: {CHECKER_ID} · {formatDate(new Date().toISOString())}
                <div style={{ marginTop: 4 }}>Reason: {rejectReason}</div>
              </div>
            </div>
          </div>
        )}
      </div>
    )
  }

  return (
    <div>
      <div className="alert alert-warning" style={{ marginBottom: 20 }}>
        <span className="alert-icon">👁️</span>
        <div>
          <strong>Action Required</strong>
          <div style={{ fontSize: '0.84rem', marginTop: 4 }}>
            Review the AI analysis above, then approve or reject this request.
            Checker ID: <span style={{ fontFamily: 'monospace', fontWeight: 700 }}>{CHECKER_ID}</span>
          </div>
        </div>
      </div>

      {actionError && (
        <div className="alert alert-error" style={{ marginBottom: 16 }}>
          <span className="alert-icon">⚠️</span>
          <div>{actionError}</div>
        </div>
      )}

      {/* Confirmation prompt */}
      {confirming === 'approve' && (
        <div className="alert alert-success" style={{ marginBottom: 16 }}>
          <span className="alert-icon">❓</span>
          <div style={{ flex: 1 }}>
            <strong>Confirm Approval</strong>
            <div style={{ fontSize: '0.84rem', marginTop: 4 }}>
              Are you sure you want to approve this request? This will trigger RPS execution.
            </div>
            <div className="action-row" style={{ marginTop: 12 }}>
              <button className="btn-approve btn-sm" onClick={doApprove} disabled={loading}>
                {loading ? <span className="spinner" /> : '✓'} Yes, Approve
              </button>
              <button className="btn-secondary btn-sm" onClick={() => setConfirming(null)} disabled={loading}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reject panel */}
      {showRejectInput && (
        <div className="reject-panel" style={{ marginBottom: 16 }}>
          <div className="reject-panel-title">Rejection Reason <span style={{ color: 'var(--red)' }}>*</span></div>
          <textarea
            className="reject-textarea"
            placeholder="Provide a clear reason for rejection..."
            value={rejectReason}
            onChange={e => setRejectReason(e.target.value)}
            disabled={loading}
          />
          {confirming === 'reject' ? (
            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: '0.84rem', fontWeight: 600, color: '#7f1d1d', marginBottom: 10 }}>
                Confirm rejection with the reason above?
              </div>
              <div className="action-row">
                <button className="btn-reject btn-sm" onClick={doReject} disabled={loading}>
                  {loading ? <span className="spinner" /> : '✕'} Yes, Reject
                </button>
                <button className="btn-secondary btn-sm" onClick={() => setConfirming(null)} disabled={loading}>
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="action-row" style={{ marginTop: 12 }}>
              <button
                className="btn-reject btn-sm"
                onClick={() => { setActionError(null); setConfirming('reject') }}
                disabled={loading || !rejectReason.trim()}
              >
                Confirm Reject
              </button>
              <button className="btn-secondary btn-sm" onClick={() => { setShowRejectInput(false); setRejectReason(''); setConfirming(null) }}>
                Cancel
              </button>
            </div>
          )}
        </div>
      )}

      {/* Primary action buttons */}
      {!confirming && (
        <div className="action-row">
          <button
            className="btn-approve"
            onClick={() => { setShowRejectInput(false); setActionError(null); setConfirming('approve') }}
            disabled={loading}
          >
            ✓ Approve Request
          </button>
          <button
            className="btn-reject"
            onClick={() => { setConfirming(null); setActionError(null); setShowRejectInput(prev => !prev) }}
            disabled={loading}
          >
            ✕ Reject Request
          </button>
        </div>
      )}
    </div>
  )
}

/* ---- Main component ---- */
export default function RequestDetail() {
  const { requestId } = useParams()
  const navigate = useNavigate()
  const [request, setRequest] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)

  async function fetchRequest() {
    setLoading(true)
    setError(null)
    try {
      const res = await axios.get(`${API_BASE}/api/requests/${requestId}`)
      setRequest(res.data)
    } catch (err) {
      setError(
        err.response?.data?.detail ||
        err.response?.data?.message ||
        err.message ||
        'Failed to load request.'
      )
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (requestId) fetchRequest()
  }, [requestId])

  if (loading) {
    return (
      <div>
        <button className="back-link" onClick={() => navigate('/checker')}>← Back to Dashboard</button>
        <div className="card" style={{ textAlign: 'center', padding: '60px 32px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, color: 'var(--gray-600)' }}>
            <span className="spinner spinner-dark" />
            Loading request details…
          </div>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div>
        <button className="back-link" onClick={() => navigate('/checker')}>← Back to Dashboard</button>
        <div className="alert alert-error">
          <span className="alert-icon">⚠️</span>
          <div>
            <strong>Failed to load request</strong>
            <div style={{ marginTop: 4, fontSize: '0.875rem' }}>{error}</div>
          </div>
        </div>
      </div>
    )
  }

  if (!request) return null

  const score = request.score_card
  const extracted = request.extracted_data ?? request.document_data

  return (
    <div>
      {/* Back */}
      <button className="back-link" onClick={() => navigate('/checker')}>
        ← Back to Dashboard
      </button>

      {/* ---- Header card ---- */}
      <div className="card" style={{ background: 'linear-gradient(135deg, var(--navy) 0%, #1a3558 100%)', color: 'white', border: 'none', marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16 }}>
          <div>
            <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'rgba(201,168,76,0.8)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>
              Request ID
            </div>
            <div style={{ fontFamily: 'monospace', fontSize: '1.1rem', fontWeight: 700, color: 'var(--gold)', marginBottom: 16 }}>
              {request.request_id}
            </div>
            <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
              {[
                { label: 'Customer ID',  value: request.customer_id },
                { label: 'Change Type',  value: (request.change_type ?? '—').replace(/_/g, ' ') },
                { label: 'Submitted',    value: formatDate(request.created_at ?? request.submitted_at) },
              ].map(item => (
                <div key={item.label}>
                  <div style={{ fontSize: '0.72rem', color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 3 }}>
                    {item.label}
                  </div>
                  <div style={{ fontSize: '0.9rem', fontWeight: 600, color: 'rgba(255,255,255,0.9)' }}>
                    {item.value ?? '—'}
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 10 }}>
            <StatusBadge status={request.status} />
            <a
              href={`http://localhost:8000/api/documents/${request.request_id}`}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                padding: '6px 14px', borderRadius: 8, fontSize: '0.82rem', fontWeight: 600,
                background: 'rgba(255,255,255,0.12)', color: 'rgba(255,255,255,0.9)',
                border: '1px solid rgba(255,255,255,0.2)', textDecoration: 'none',
                cursor: 'pointer',
              }}
            >
              📄 View Document
            </a>
            {request.old_value && request.new_value && (
              <div style={{ textAlign: 'right', fontSize: '0.8rem', color: 'rgba(255,255,255,0.6)' }}>
                <div><span style={{ opacity: 0.6 }}>From:</span> <span style={{ fontWeight: 600, color: 'rgba(255,255,255,0.85)' }}>{request.old_value}</span></div>
                <div><span style={{ opacity: 0.6 }}>To:</span> <span style={{ fontWeight: 600, color: 'var(--gold)' }}>{request.new_value}</span></div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ---- AI Analysis ---- */}
      {(request.ai_summary || request.filenet_reference || request.recommendation) && (
        <SectionCard title="AI Analysis" icon="🤖">
          {request.ai_summary && (
            <p style={{ fontSize: '0.92rem', color: 'var(--gray-800)', lineHeight: 1.7, marginBottom: 16 }}>
              {request.ai_summary}
            </p>
          )}
          <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', alignItems: 'center' }}>
            {request.filenet_reference && (
              <div>
                <div className="kv-label">FileNet Reference</div>
                <div className="kv-value text-mono">{request.filenet_reference}</div>
              </div>
            )}
            {request.recommendation && (
              <div>
                <div className="kv-label">AI Recommendation</div>
                <div style={{ marginTop: 4 }}><RecommendationBadge rec={request.recommendation} /></div>
              </div>
            )}
          </div>
        </SectionCard>
      )}

      {/* ---- Confidence Score Card ---- */}
      {score && (
        <SectionCard title="Confidence Score Analysis" icon="📊">
          <ConfidenceDisplay score={score} />
        </SectionCard>
      )}

      {/* ---- Extracted Document Data ---- */}
      {extracted && (
        <SectionCard title="Extracted Document Data" icon="📄">
          <ExtractedData data={extracted} />
        </SectionCard>
      )}

      {/* ---- Checker Action ---- */}
      <SectionCard title="Checker Decision" icon="⚖️">
        <ActionPanel request={request} onActionComplete={fetchRequest} />
      </SectionCard>
    </div>
  )
}

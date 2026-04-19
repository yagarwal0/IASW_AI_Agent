import { useState, useRef } from 'react'
import axios from 'axios'

const API_BASE = 'http://localhost:8000'

const CHANGE_TYPE_LABELS = {
  legal_name:     { old: 'Current Legal Name', new: 'New Legal Name' },
  address:        { old: 'Current Address',    new: 'New Address' },
  date_of_birth:  { old: 'Current DOB',        new: 'New DOB' },
  contact_email:  { old: 'Current Email',      new: 'New Email' },
}

const CHANGE_TYPE_OPTIONS = [
  { value: 'legal_name',    label: 'Legal Name Change' },
  { value: 'address',       label: 'Address Update' },
  { value: 'date_of_birth', label: 'Date of Birth Correction' },
  { value: 'contact_email', label: 'Contact Email Update' },
]

function confidenceClass(score) {
  if (score >= 80) return 'high'
  if (score >= 60) return 'medium'
  return 'low'
}

function ScoreCardResult({ result }) {
  const score = result?.score_card
  const summary = result?.ai_summary
  const requestId = result?.request_id

  if (!score && !summary) return null

  const overall = score?.overall_confidence_pct ?? 0
  const confClass = confidenceClass(overall)
  const fields = score?.field_scores ?? []
  const forgery = score?.forgery_check ?? {}

  return (
    <div className="success-card">
      <div className="success-card-header">
        <div className="success-check">✓</div>
        <div>
          <div className="success-title">Request Submitted Successfully</div>
          <div className="success-subtitle">AI analysis complete — awaiting checker review</div>
        </div>
      </div>

      {/* Key result items */}
      <div className="result-grid">
        <div className="result-item">
          <div className="result-item-label">Request ID</div>
          <div className="result-item-value">{requestId ?? '—'}</div>
        </div>
        <div className="result-item">
          <div className="result-item-label">Overall Confidence</div>
          <div className="result-item-value" style={{ color: confClass === 'high' ? 'var(--green)' : confClass === 'medium' ? 'var(--yellow)' : 'var(--red)' }}>
            {overall}%
          </div>
        </div>
        {score?.forgery_check?.result && (
          <div className="result-item">
            <div className="result-item-label">Forgery Check</div>
            <div className="result-item-value">{score.forgery_check.result}</div>
          </div>
        )}
        {result?.status && (
          <div className="result-item">
            <div className="result-item-label">Status</div>
            <div className="result-item-value">{result.status}</div>
          </div>
        )}
      </div>

      {/* AI Summary */}
      {summary && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: '0.78rem', fontWeight: 700, color: '#166534', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
            AI Summary
          </div>
          <p style={{ fontSize: '0.9rem', color: '#14532d', lineHeight: 1.6 }}>{summary}</p>
        </div>
      )}

      {/* Field Scores */}
      {fields.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: '0.78rem', fontWeight: 700, color: '#166534', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
            Field Scores
          </div>
          <div className="score-row-header">
            <span>Field</span>
            <span>Extracted</span>
            <span>Requested</span>
            <span style={{ textAlign: 'center' }}>Score</span>
            <span>Status</span>
          </div>
          {fields.map((f, i) => {
            const st = (f.status ?? '').toLowerCase()
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
        <div className={`forgery-result ${forgery.result === 'CLEAN' ? 'clean' : forgery.result === 'SUSPECT' ? 'suspect' : 'warning'}`}>
          <span className="forgery-icon">
            {forgery.result === 'CLEAN' ? '🛡️' : forgery.result === 'SUSPECT' ? '🚨' : '⚠️'}
          </span>
          <span>Forgery Check: {forgery.result}</span>
          {forgery.confidence_pct != null && (
            <span style={{ marginLeft: 'auto', fontSize: '0.85rem', opacity: 0.8 }}>
              Confidence: {forgery.confidence_pct}%
            </span>
          )}
        </div>
      )}

      {forgery?.indicators && forgery.indicators.length > 0 && (
        <ul className="forgery-indicators">
          {forgery.indicators.map((ind, i) => <li key={i}>{ind}</li>)}
        </ul>
      )}
    </div>
  )
}

export default function IntakeForm() {
  const [form, setForm] = useState({
    customer_id: '',
    change_type: 'legal_name',
    old_value: '',
    new_value: '',
  })
  const [file, setFile] = useState(null)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)
  const fileInputRef = useRef(null)

  const labels = CHANGE_TYPE_LABELS[form.change_type] ?? { old: 'Old Value', new: 'New Value' }

  function handleChange(e) {
    const { name, value } = e.target
    setForm(prev => ({ ...prev, [name]: value }))
    setError(null)
  }

  function handleFile(e) {
    const f = e.target.files?.[0] ?? null
    setFile(f)
    setError(null)
  }

  const DEMO_SCENARIOS = [
    {
      label: '👰 Legal Name',
      customer_id: 'C001',
      change_type: 'legal_name',
      old_value: 'Priya Sharma',
      new_value: 'Priya Mehta',
      doc_hint: 'Upload a Marriage Certificate image/PDF',
    },
    {
      label: '🏠 Address',
      customer_id: 'C002',
      change_type: 'address',
      old_value: '45 Park Street, New Delhi 110001',
      new_value: '12 Connaught Place, New Delhi 110001',
      doc_hint: 'Upload a Utility Bill or Lease Agreement',
    },
    {
      label: '🎂 Date of Birth',
      customer_id: 'C003',
      change_type: 'date_of_birth',
      old_value: '1992-11-30',
      new_value: '1992-11-03',
      doc_hint: 'Upload a Birth Certificate or Passport',
    },
    {
      label: '📧 Email',
      customer_id: 'C001',
      change_type: 'contact_email',
      old_value: 'priya.sharma@example.com',
      new_value: 'priya.mehta@newdomain.com',
      doc_hint: 'Upload a Digital Consent Form',
    },
  ]

  function quickFill(scenario) {
    setForm({
      customer_id: scenario.customer_id,
      change_type: scenario.change_type,
      old_value: scenario.old_value,
      new_value: scenario.new_value,
    })
    setResult(null)
    setError(null)
  }

  function resetForm() {
    setForm({ customer_id: '', change_type: 'legal_name', old_value: '', new_value: '' })
    setFile(null)
    setResult(null)
    setError(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError(null)
    setResult(null)

    if (!form.customer_id.trim()) {
      setError('Customer ID is required.')
      return
    }
    if (!form.old_value.trim() || !form.new_value.trim()) {
      setError('Both old and new values are required.')
      return
    }

    setLoading(true)
    try {
      const fd = new FormData()
      fd.append('customer_id', form.customer_id.trim())
      fd.append('change_type', form.change_type)
      fd.append('old_value', form.old_value.trim())
      fd.append('new_value', form.new_value.trim())
      if (file) {
        fd.append('document', file)
      }

      const response = await axios.post(`${API_BASE}/api/requests`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      setResult(response.data)
    } catch (err) {
      const msg =
        err.response?.data?.detail ||
        err.response?.data?.message ||
        (typeof err.response?.data === 'string' ? err.response.data : null) ||
        err.message ||
        'An unexpected error occurred.'
      setError(typeof msg === 'string' ? msg : JSON.stringify(msg))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">
          <span>📋</span> Staff Intake Form
        </h1>
        <p className="page-subtitle">
          Submit a customer account change request for AI-assisted verification
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.2fr) minmax(0,0.8fr)', gap: 24, alignItems: 'start' }}>
        {/* Left: Form */}
        <div>
          <div className="card">
            <div className="card-header">
              <div className="card-title">
                <span className="card-title-icon">✏️</span>
                New Change Request
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {DEMO_SCENARIOS.map((s, i) => (
                  <button key={i} className="btn-gold btn-sm" onClick={() => quickFill(s)} type="button" title={s.doc_hint}>
                    {s.label}
                  </button>
                ))}
              </div>
            </div>

            <form onSubmit={handleSubmit} noValidate>
              {/* Customer ID */}
              <div className="form-group">
                <label className="form-label" htmlFor="customer_id">
                  Customer ID <span className="required">*</span>
                </label>
                <input
                  id="customer_id"
                  name="customer_id"
                  className="form-input"
                  type="text"
                  placeholder="e.g. C001"
                  value={form.customer_id}
                  onChange={handleChange}
                  disabled={loading}
                  autoComplete="off"
                />
              </div>

              {/* Change Type */}
              <div className="form-group">
                <label className="form-label" htmlFor="change_type">
                  Change Type <span className="required">*</span>
                </label>
                <select
                  id="change_type"
                  name="change_type"
                  className="form-select"
                  value={form.change_type}
                  onChange={handleChange}
                  disabled={loading}
                >
                  {CHANGE_TYPE_OPTIONS.map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>

              {/* Old / New values */}
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label" htmlFor="old_value">
                    {labels.old} <span className="required">*</span>
                  </label>
                  <input
                    id="old_value"
                    name="old_value"
                    className="form-input"
                    type="text"
                    placeholder={`Current ${labels.old.toLowerCase()}`}
                    value={form.old_value}
                    onChange={handleChange}
                    disabled={loading}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label" htmlFor="new_value">
                    {labels.new} <span className="required">*</span>
                  </label>
                  <input
                    id="new_value"
                    name="new_value"
                    className="form-input"
                    type="text"
                    placeholder={`New ${labels.new.toLowerCase()}`}
                    value={form.new_value}
                    onChange={handleChange}
                    disabled={loading}
                  />
                </div>
              </div>

              {/* Document Upload */}
              <div className="form-group">
                <label className="form-label">
                  Supporting Document
                </label>
                <label className={`form-file-label ${file ? 'has-file' : ''}`}>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".pdf,.jpg,.jpeg,.png"
                    onChange={handleFile}
                    disabled={loading}
                    style={{ display: 'none' }}
                  />
                  {file ? (
                    <>
                      <span className="form-file-icon">📄</span>
                      <span className="form-file-name">{file.name}</span>
                      <span className="form-file-text" style={{ color: 'var(--green)' }}>
                        {(file.size / 1024).toFixed(1)} KB — click to change
                      </span>
                    </>
                  ) : (
                    <>
                      <span className="form-file-icon">📎</span>
                      <span className="form-file-text">Click to upload or drag & drop</span>
                      <span className="form-file-hint">PDF, JPG, PNG accepted</span>
                    </>
                  )}
                </label>
              </div>

              {/* Error */}
              {error && (
                <div className="alert alert-error">
                  <span className="alert-icon">⚠️</span>
                  <div>{error}</div>
                </div>
              )}

              {/* Actions */}
              <div className="action-row" style={{ marginTop: 8 }}>
                <button className="btn-primary" type="submit" disabled={loading}>
                  {loading ? (
                    <>
                      <span className="spinner" />
                      Processing…
                    </>
                  ) : (
                    <>
                      <span>🚀</span>
                      Submit Request
                    </>
                  )}
                </button>
                {!loading && (
                  <button className="btn-secondary" type="button" onClick={resetForm}>
                    Reset
                  </button>
                )}
              </div>
            </form>
          </div>
        </div>

        {/* Right: Info panel */}
        <div>
          <div className="card" style={{ background: 'linear-gradient(135deg, #0A1628 0%, #1a3558 100%)', color: 'white', border: 'none' }}>
            <div className="card-title" style={{ color: 'var(--gold)', marginBottom: 16 }}>
              <span className="card-title-icon" style={{ background: 'rgba(201,168,76,0.15)' }}>💡</span>
              How It Works
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {[
                { step: '1', icon: '📋', title: 'Fill the Form', desc: 'Enter customer details and upload a supporting document' },
                { step: '2', icon: '🤖', title: 'AI Analysis', desc: 'Our AI agent extracts data, validates fields, and checks for forgery' },
                { step: '3', icon: '📊', title: 'Confidence Score', desc: 'Each field is scored and an overall confidence percentage is computed' },
                { step: '4', icon: '👁️', title: 'Checker Review', desc: 'A human checker reviews the AI analysis and approves or rejects' },
                { step: '5', icon: '✅', title: 'Execution', desc: 'Approved changes are committed and logged in the audit trail' },
              ].map(item => (
                <div key={item.step} style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                  <div style={{
                    minWidth: 28, height: 28, borderRadius: '50%',
                    background: 'rgba(201,168,76,0.2)', border: '1px solid rgba(201,168,76,0.35)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: '0.7rem', fontWeight: 800, color: 'var(--gold)'
                  }}>{item.step}</div>
                  <div>
                    <div style={{ fontSize: '0.84rem', fontWeight: 700, color: 'rgba(255,255,255,0.9)', marginBottom: 2 }}>
                      {item.icon} {item.title}
                    </div>
                    <div style={{ fontSize: '0.78rem', color: 'rgba(255,255,255,0.5)', lineHeight: 1.5 }}>{item.desc}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="card" style={{ padding: '16px 20px' }}>
            <div style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--gray-600)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>
              Supported Change Types
            </div>
            {[
              { value: 'legal_name',    label: 'Legal Name Change',        docs: 'Marriage Certificate, Gazette Notification, Deed Poll' },
              { value: 'address',       label: 'Address Update',           docs: 'Utility Bill, Lease Agreement, Govt ID' },
              { value: 'date_of_birth', label: 'Date of Birth Correction', docs: 'Birth Certificate, Passport, PAN Card' },
              { value: 'contact_email', label: 'Contact Email Update',     docs: 'Digital Consent Form' },
            ].map(opt => (
              <div key={opt.value} style={{
                padding: '8px 0', borderBottom: '1px solid var(--gray-100)',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                  <span style={{ color: 'var(--gold)', fontWeight: 700, fontSize: '0.7rem', textTransform: 'uppercase' }}>
                    {opt.value}
                  </span>
                  <span style={{ marginLeft: 'auto', color: 'var(--navy)', fontSize: '0.82rem', fontWeight: 600 }}>{opt.label}</span>
                </div>
                <div style={{ fontSize: '0.74rem', color: 'var(--gray-500)', paddingLeft: 2 }}>📄 {opt.docs}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Result */}
      {result && <ScoreCardResult result={result} />}
    </div>
  )
}

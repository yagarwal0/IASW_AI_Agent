import { useState, useEffect, useCallback } from 'react'
import axios from 'axios'

const API_BASE = 'http://localhost:8000'
const REFRESH_INTERVAL = 10000

function formatDate(str) {
  if (!str) return '—'
  try {
    return new Date(str).toLocaleString(undefined, {
      month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    })
  } catch {
    return str
  }
}

function truncate(str, n = 14) {
  if (!str) return '—'
  return str.length > n ? str.slice(0, n) + '…' : str
}

function getEventClass(eventType) {
  if (!eventType) return ''
  const t = eventType.toUpperCase()
  if (t.includes('AGENT') || t.includes('STEP')) return 'agent-step'
  if (t.includes('CONFIDENCE') || t.includes('SCORE')) return 'confidence'
  if (t.includes('HUMAN') || t.includes('DECISION') || t.includes('APPROVE') || t.includes('REJECT')) return 'human-decision'
  return ''
}

function getEventIcon(eventType) {
  if (!eventType) return '📝'
  const t = eventType.toUpperCase()
  if (t.includes('AGENT')) return '🤖'
  if (t.includes('STEP')) return '⚙️'
  if (t.includes('CONFIDENCE') || t.includes('SCORE')) return '📊'
  if (t.includes('APPROVE')) return '✅'
  if (t.includes('REJECT')) return '❌'
  if (t.includes('HUMAN') || t.includes('DECISION')) return '👤'
  if (t.includes('SUBMIT') || t.includes('CREATE')) return '📋'
  if (t.includes('FILENET')) return '🗄️'
  if (t.includes('RPS')) return '🏦'
  return '📝'
}

function EventTypeBadge({ eventType }) {
  const cls = getEventClass(eventType)
  const icon = getEventIcon(eventType)
  return (
    <span className={`audit-event-type ${cls}`}>
      {icon} {eventType ?? 'UNKNOWN'}
    </span>
  )
}

function AuditEventCard({ event }) {
  const cls = getEventClass(event.event_type)
  return (
    <div className={`audit-event ${cls}`}>
      <div className="audit-event-header">
        <EventTypeBadge eventType={event.event_type} />
        <span className="audit-event-time">{formatDate(event.timestamp)}</span>
      </div>
      {event.step && (
        <div className="audit-event-step">{event.step}</div>
      )}
      {event.request_id && (
        <div className="audit-event-request">
          Request: <span title={event.request_id}>{truncate(event.request_id, 20)}</span>
        </div>
      )}
      {event.detail && (
        <div className="audit-event-detail">{event.detail}</div>
      )}
    </div>
  )
}

function AuditTable({ events }) {
  return (
    <div className="table-container">
      <table>
        <thead>
          <tr>
            <th>Timestamp</th>
            <th>Event Type</th>
            <th>Request ID</th>
            <th>Step</th>
            <th>Detail</th>
          </tr>
        </thead>
        <tbody>
          {events.map((event, i) => {
            const cls = getEventClass(event.event_type)
            const rowStyle = {
              borderLeft: cls === 'agent-step' ? '3px solid var(--blue)' :
                          cls === 'confidence' ? '3px solid var(--purple)' :
                          cls === 'human-decision' ? '3px solid var(--orange)' :
                          '3px solid transparent'
            }
            return (
              <tr key={i} style={rowStyle}>
                <td>
                  <span style={{ fontFamily: 'monospace', fontSize: '0.8rem', color: 'var(--gray-600)', whiteSpace: 'nowrap' }}>
                    {formatDate(event.timestamp)}
                  </span>
                </td>
                <td><EventTypeBadge eventType={event.event_type} /></td>
                <td>
                  <span className="td-mono" title={event.request_id}>
                    {truncate(event.request_id, 16)}
                  </span>
                </td>
                <td>
                  <span style={{ fontSize: '0.875rem', color: 'var(--navy)', fontWeight: 600 }}>
                    {event.step ?? '—'}
                  </span>
                </td>
                <td>
                  <span style={{ fontSize: '0.82rem', color: 'var(--gray-600)', maxWidth: 340, display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                        title={event.detail}>
                    {event.detail ?? '—'}
                  </span>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

export default function AuditLog() {
  const [events, setEvents] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [viewMode, setViewMode] = useState('timeline') // 'timeline' | 'table'
  const [filter, setFilter] = useState('')
  const [lastRefresh, setLastRefresh] = useState(null)

  const fetchAuditLog = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    setError(null)
    try {
      const res = await axios.get(`${API_BASE}/api/audit-log`)
      const data = Array.isArray(res.data)
        ? res.data
        : Array.isArray(res.data?.events)
          ? res.data.events
          : Array.isArray(res.data?.audit_log)
            ? res.data.audit_log
            : []
      // Normalize backend fields: backend sends {time, step, detail, request_id}
      const normalized = data.map(e => ({
        ...e,
        timestamp:  e.timestamp  ?? e.time ?? null,
        event_type: e.event_type ?? e.step ?? null,
      }))
      // Sort newest first
      const sorted = [...normalized].sort((a, b) => {
        const ta = new Date(a.timestamp ?? 0).getTime()
        const tb = new Date(b.timestamp ?? 0).getTime()
        return tb - ta
      })
      setEvents(sorted)
      setLastRefresh(new Date())
    } catch (err) {
      setError(
        err.response?.data?.detail ||
        err.response?.data?.message ||
        err.message ||
        'Failed to load audit log.'
      )
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchAuditLog(false)
  }, [fetchAuditLog])

  useEffect(() => {
    const id = setInterval(() => fetchAuditLog(true), REFRESH_INTERVAL)
    return () => clearInterval(id)
  }, [fetchAuditLog])

  const eventTypes = ['', ...Array.from(new Set(events.map(e => e.event_type).filter(Boolean)))]

  const filtered = filter
    ? events.filter(e => (e.event_type ?? '').toUpperCase().includes(filter.toUpperCase()))
    : events

  // Stats
  const agentSteps    = events.filter(e => getEventClass(e.event_type) === 'agent-step').length
  const confidences   = events.filter(e => getEventClass(e.event_type) === 'confidence').length
  const humanActions  = events.filter(e => getEventClass(e.event_type) === 'human-decision').length

  return (
    <div>
      <div className="page-header" style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between' }}>
        <div>
          <h1 className="page-title">
            <span>📜</span> Audit Log
          </h1>
          <p className="page-subtitle">
            Complete event trail for all account change requests
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {lastRefresh && (
            <div className="refresh-info">
              <span className="refresh-dot" />
              Refreshes every 10s · Last: {lastRefresh.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </div>
          )}
          <button
            className="btn-secondary btn-sm"
            onClick={() => fetchAuditLog(false)}
            disabled={loading}
          >
            {loading ? <span className="spinner spinner-dark" /> : '↺'} Refresh
          </button>
        </div>
      </div>

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 24 }}>
        {[
          { label: 'Total Events',   count: events.length,  icon: '📊', color: 'var(--navy)' },
          { label: 'Agent Steps',    count: agentSteps,     icon: '🤖', color: 'var(--blue)' },
          { label: 'Confidence Scores', count: confidences, icon: '📈', color: 'var(--purple)' },
          { label: 'Human Decisions',count: humanActions,   icon: '👤', color: 'var(--orange)' },
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

      {/* Color legend */}
      <div className="card" style={{ padding: '12px 20px', marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap' }}>
          <span style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--gray-600)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Legend:</span>
          {[
            { cls: 'agent-step',     label: 'Agent Step',     color: 'var(--blue)' },
            { cls: 'confidence',     label: 'Confidence Score', color: 'var(--purple)' },
            { cls: 'human-decision', label: 'Human Decision', color: 'var(--orange)' },
          ].map(item => (
            <div key={item.cls} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div style={{ width: 10, height: 10, borderRadius: '50%', background: item.color }} />
              <span style={{ fontSize: '0.8rem', color: 'var(--gray-600)', fontWeight: 600 }}>{item.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Controls */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, gap: 12, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <label style={{ fontSize: '0.84rem', fontWeight: 600, color: 'var(--navy)' }}>Filter:</label>
          <select
            className="form-select"
            style={{ width: 220, padding: '7px 36px 7px 12px', fontSize: '0.84rem' }}
            value={filter}
            onChange={e => setFilter(e.target.value)}
          >
            <option value="">All Event Types</option>
            {eventTypes.filter(Boolean).map(t => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>

        <div className="filter-tabs" style={{ marginBottom: 0 }}>
          <button
            className={`filter-tab ${viewMode === 'timeline' ? 'active' : ''}`}
            onClick={() => setViewMode('timeline')}
          >
            🕐 Timeline
          </button>
          <button
            className={`filter-tab ${viewMode === 'table' ? 'active' : ''}`}
            onClick={() => setViewMode('table')}
          >
            📋 Table
          </button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="alert alert-error" style={{ marginBottom: 16 }}>
          <span className="alert-icon">⚠️</span>
          <div>{error}</div>
        </div>
      )}

      {/* Content */}
      {loading ? (
        <div className="card" style={{ textAlign: 'center', padding: '60px 32px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, color: 'var(--gray-600)' }}>
            <span className="spinner spinner-dark" />
            Loading audit log…
          </div>
        </div>
      ) : filtered.length === 0 ? (
        <div className="card">
          <div className="empty-state">
            <span className="empty-state-icon">📭</span>
            <div className="empty-state-title">No audit events found</div>
            <div className="empty-state-text">
              {filter ? `No events matching "${filter}".` : 'Events will appear here as requests are processed.'}
            </div>
          </div>
        </div>
      ) : viewMode === 'timeline' ? (
        <div className="audit-timeline">
          {filtered.map((event, i) => (
            <AuditEventCard key={i} event={event} />
          ))}
        </div>
      ) : (
        <AuditTable events={filtered} />
      )}

      <div style={{ marginTop: 12, fontSize: '0.78rem', color: 'var(--gray-400)', textAlign: 'right' }}>
        {filtered.length} event{filtered.length !== 1 ? 's' : ''} shown
        {filter && ` (filtered from ${events.length})`}
      </div>
    </div>
  )
}

# IASW — Intelligent Account Servicing Workflow

An agentic AI application that automates document verification and data validation for core banking account change requests, with a strict **Human-in-the-Loop (HITL) Checker** gate before any update is committed to the core system.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    STAFF INTAKE FORM (React)                    │
│  Customer ID + Change Type + Old/New Value + Document Upload    │
└───────────────────────────┬─────────────────────────────────────┘
                            │  POST /api/requests (multipart)
                            ▼  [SYNCHRONOUS]
┌─────────────────────────────────────────────────────────────────┐
│                     FASTAPI BACKEND (pipeline.py)                │
│                                                                 │
│  1. validate()        ─→ Mock RPS lookup + old-value match      │
│  2. store_document()  ─→ FileNet mock + ChromaDB SHA-256 dedup  │
│  3. extract()         ─→ Google DocAI OCR (GPT-4o fallback)     │
│  4. score()           ─→ difflib field matching → PASS/FLAG/FAIL│
│  5. summarize()       ─→ LangChain prompt chain + GPT-4o        │
│  6. MySQL insert      ─→ status = AI_VERIFIED_PENDING_HUMAN     │
└───────────────────────────┬─────────────────────────────────────┘
                            │  GET /api/requests
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                  CHECKER REVIEW UI (React)                      │
│  AI Summary + Confidence Scores + Forgery Check + Doc Preview   │
│                                                                 │
│       [ APPROVE ]                    [ REJECT ]                 │
│           │                               │                     │
│           ▼ POST /approve                 ▼ POST /reject        │
│    ┌──────────────┐              No RPS write → REJECTED        │
│    │  rps_write() │  ◄── ONLY entry point to core system        │
│    │  (MOCK_RPS)  │      AI pipeline NEVER calls this           │
│    └──────────────┘                                             │
└─────────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│              OBSERVABILITY (Audit Log)                          │
│  In-memory AUDIT_LOG list — every step, score, decision logged  │
│  Exposed via GET /api/audit-log                                 │
└─────────────────────────────────────────────────────────────────┘
```

## Tech Stack

| Layer | Choice | Justification |
|---|---|---|
| Frontend | React 18 + Vite | Fast HMR, component-based UI |
| Backend | FastAPI | Async Python, auto OpenAPI docs |
| Orchestration | LangChain | `ChatPromptTemplate \| ChatOpenAI` chain for Summary Agent |
| LLM | GPT-4o (OpenAI) | Vision extraction + narrative summary generation |
| OCR | Google Document AI | Enterprise-grade OCR with layout understanding |
| Relational DB | MySQL | ACID compliance for banking pending table |
| Vector Store | ChromaDB | SHA-256-based duplicate document detection |
| Document Store | Local FS (FileNet mock) | Simulates IBM FileNet P8 |
| Observability | In-memory audit log + file sink | Structured event trail (`iasw_audit.log`) |

## HITL Constraint Enforcement

The AI pipeline **never** calls `rps_write()`. The only code path to the RPS write is:

```
Human clicks "Approve" in Checker UI
  → POST /api/requests/{id}/approve
    → approve() in main.py
      → pipeline.rps_write()   ← ONLY call site in the entire codebase
```

All AI pipeline functions (`validate`, `store_document`, `extract`, `score`, `summarize`) are read-only. They produce a staged record with status `AI_VERIFIED_PENDING_HUMAN` and stop.

## Confidence Scoring

Each extracted field is compared to the requested value using `difflib.SequenceMatcher`:

| Score | Status |
|---|---|
| ≥ 85 % | PASS |
| 60–84 % | FLAG |
| < 60 % | FAIL |

**Overall confidence** is the average of all field scores. A separate **forgery check** flags the submission if any of these is true:
- Document number missing
- Issuing authority missing
- Duplicate document detected by ChromaDB

**Recommendation** is derived: `APPROVE` (overall ≥ 80 AND forgery = PASS) · `REVIEW` (≥ 60) · `REJECT` (otherwise). The recommendation is advisory only — the Checker always makes the final call.

## Setup

### Prerequisites
- Python 3.11+
- Node.js 18+
- MySQL 8.0+ running locally
- OpenAI API key

### 1. MySQL Setup
```sql
CREATE DATABASE iasw_db;
```

### 2. Backend Setup
```bash
cd backend
cp .env.example .env
# Edit .env — set OPENAI_API_KEY and DATABASE_URL

pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

Backend runs at http://localhost:8000
API docs: http://localhost:8000/docs

### 3. Frontend Setup
```bash
cd frontend
npm install
npm run dev
```

Frontend runs at http://localhost:5173

### 4. Google Document AI (Optional)
If you have a Google Cloud project with Document AI enabled:
1. Create a Form Parser or Document OCR processor
2. Set `GOOGLE_CLOUD_PROJECT`, `GOOGLE_DOCAI_LOCATION`, `GOOGLE_DOCAI_PROCESSOR_ID` in `.env`
3. Set `GOOGLE_APPLICATION_CREDENTIALS` to your service account JSON path

If not configured, the system automatically falls back to GPT-4o vision for image documents.

## API Endpoints

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/requests` | Staff submits a change request (runs full pipeline) |
| GET | `/api/requests` | Checker lists all requests (filter with `?status=`) |
| GET | `/api/requests/{request_id}` | Checker views one request |
| POST | `/api/requests/{request_id}/approve` | 🔒 HITL gate — triggers `rps_write()` |
| POST | `/api/requests/{request_id}/reject` | Reject with reason (no RPS write) |
| GET | `/api/audit-log` | Full audit trail (in-memory) |
| GET | `/api/documents/{request_id}` | Preview uploaded document |
| GET | `/api/rps/{customer_id}` | Inspect mock RPS record |
| GET | `/health` | Liveness check |

## Demo Flow — Legal Name Change

1. Open http://localhost:5173
2. Click **"Quick Fill Demo"** — pre-fills:
   - Customer ID: `C001`
   - Change Type: `legal_name`
   - Old Name: `Priya Sharma`
   - New Name: `Priya Mehta`
3. Upload any image/PDF (e.g. a mock marriage certificate)
4. Click **Submit** — pipeline runs (validate → store → extract → score → summarize)
5. Navigate to **Checker Dashboard** — request appears as `AI_VERIFIED_PENDING_HUMAN`
6. Click **Review** → see:
   - AI Summary narrative
   - Per-field confidence scores (color-coded)
   - Forgery check result
   - **View Document** button opens the uploaded file in a new tab
7. Click **Approve** → `pipeline.rps_write()` executes → status = `APPROVED`
8. Open **Audit Log** to see the full timeline (every agent step, score, and decision)

## Mock Customer Data (MOCK_RPS)

Defined in [backend/pipeline.py](backend/pipeline.py):

| Customer ID | Name | Address | DOB | Email |
|---|---|---|---|---|
| C001 | Priya Sharma | Poonch Colony, Jammu | 1999-05-15 | priya.sharma@gmail.com |
| C002 | Yash Agarwal | Mohalla Hathi Khana, Chandausi | 1999-05-05 | yash@iitjammu.com |
| C003 | Neha Sharma | IIT Jammu | 2001-11-30 | neha@outlook.com |

## Data Model — Pending Table

```sql
CREATE TABLE change_requests (
  request_id         VARCHAR(36) PRIMARY KEY,
  customer_id        VARCHAR(50),
  change_type        VARCHAR(50),   -- legal_name | address | date_of_birth | contact_email
  old_value          VARCHAR(500),
  new_value          VARCHAR(500),
  extracted_data     TEXT,           -- JSON: OCR-extracted fields
  score_card         TEXT,           -- JSON: per-field confidence scores
  ai_summary         TEXT,           -- LLM-generated narrative for Checker
  filenet_ref        VARCHAR(200),   -- Mock FileNet document reference
  status             VARCHAR(50),    -- AI_VERIFIED_PENDING_HUMAN | APPROVED | REJECTED
  overall_confidence FLOAT,
  forgery_check      VARCHAR(20),    -- PASS | FLAG
  checker_id         VARCHAR(50),
  checker_decision   VARCHAR(20),
  rejection_reason   TEXT,
  created_at         DATETIME,
  decided_at         DATETIME
);
```

## Project Structure

```
agivant/
├── backend/
│   ├── main.py              # FastAPI app — 9 routes, HITL gate on /approve
│   ├── pipeline.py          # All 5 AI pipeline steps + MOCK_RPS + rps_write()
│   ├── database.py          # SQLAlchemy ChangeRequest model + session
│   ├── requirements.txt
│   ├── chroma_store/        # ChromaDB persistent store (doc fingerprints)
│   ├── filenet_store/       # Mock FileNet — uploaded documents per request
│   └── iasw_audit.log       # Append-only audit log file sink
├── frontend/
│   └── src/
│       ├── App.jsx
│       ├── main.jsx
│       ├── index.css
│       └── components/
│           ├── IntakeForm.jsx        # Staff submission form
│           ├── CheckerDashboard.jsx  # Pending requests list
│           ├── RequestDetail.jsx     # AI review + approve/reject + doc preview
│           └── AuditLog.jsx          # Timeline + table view of audit events
└── README.md
```

## Why a Flat Backend?

The backend uses **3 files** (`main.py`, `pipeline.py`, `database.py`) instead of a layered `agents/` / `services/` / `models/` package structure. This was a deliberate trade-off for a prototype:

- **Fewer imports, less ceremony** — all pipeline steps are visible in one scroll
- **Reviewer-friendly** — the entire HITL enforcement is a single grep away (`rps_write` is called exactly once, in `main.py`)
- **Refactor later** — if this were production, the pipeline would split into agent modules, but splitting too early hides the architecture behind file boundaries

## Known Limitations

- **Single-process audit log** — `AUDIT_LOG` is in-memory; resets on backend restart. A real deployment would use a dedicated audit DB or append-only log service.
- **Forgery detection is heuristic** — authenticity score just checks that document number, issuing authority, and date fields were extracted. No signature verification, template matching, or registry cross-check.
- **No authentication** — any client can hit `/api/requests/{id}/approve`. Production would require role-based auth (Maker vs Checker) and non-repudiation.
- **ChromaDB dedup uses SHA-256 only** — byte-identical duplicates are caught; a re-scanned or slightly modified version of the same document would not be.
- **MOCK_RPS is a dict** — no transaction semantics. A real RPS integration would need retry/idempotency handling on `rps_write()`.

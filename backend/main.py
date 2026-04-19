"""
main.py — FastAPI routes for IASW

There are 6 routes:
  POST /api/requests              — staff submits a change request
  GET  /api/requests              — checker views all requests
  GET  /api/requests/{id}         — checker views one request
  POST /api/requests/{id}/approve — checker approves → RPS write
  POST /api/requests/{id}/reject  — checker rejects → no RPS write
  GET  /api/audit-log             — view full audit trail
"""

from fastapi import FastAPI, UploadFile, File, Form, HTTPException, Depends, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from pathlib import Path
import uuid, json
from datetime import datetime
from typing import Optional

from database import get_db, init_db, ChangeRequest
import pipeline

app = FastAPI(title="IASW — Intelligent Account Servicing Workflow")

app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

@app.on_event("startup")
def startup():
    init_db()

@app.get("/health")
def health():
    return {"status": "ok"}


# ──────────────────────────────────────────────────────────────────────────
# ROUTE 1: Staff submits a change request
# Runs the full AI pipeline: validate → store → extract → score → summarize
# Saves result with status AI_VERIFIED_PENDING_HUMAN (AI stops here)
# ──────────────────────────────────────────────────────────────────────────
@app.post("/api/requests")
async def submit_request(
    customer_id: str        = Form(...),
    change_type: str        = Form(...),
    old_value:   str        = Form(...),
    new_value:   str        = Form(...),
    document:    UploadFile = File(...),
    db: Session = Depends(get_db),
):
    request_id = str(uuid.uuid4())
    pipeline.log(request_id, "INTAKE", f"{change_type} for {customer_id}: '{old_value}' → '{new_value}'")

    # Step 1 — Validate
    ok, msg = pipeline.validate(customer_id, change_type, old_value)
    if not ok:
        raise HTTPException(status_code=400, detail=msg)
    pipeline.log(request_id, "VALIDATION", "PASSED")

    # Step 2 — Save document to FileNet mock + ChromaDB duplicate check
    doc_bytes = await document.read()
    filenet_ref, is_duplicate = pipeline.store_document(request_id, document.filename, doc_bytes)
    pipeline.log(request_id, "FILENET_STORE", f"ref={filenet_ref} duplicate={is_duplicate}")

    # Step 3 — Extract fields from document (Google Doc AI or GPT-4o vision)
    extracted = pipeline.extract(doc_bytes, document.filename, change_type)
    pipeline.log(request_id, "OCR_EXTRACTION", f"Extracted {len(extracted)} fields")

    # Step 4 — Score confidence per field
    score_card = pipeline.score(change_type, old_value, new_value, extracted, is_duplicate)
    pipeline.log(request_id, "CONFIDENCE_SCORE",
                 f"Overall={score_card['overall_confidence']}% Forgery={score_card['forgery_check']}")

    # Step 5 — Generate AI summary for the Checker (LangChain prompt chain)
    ai_summary = pipeline.summarize(change_type, old_value, new_value, extracted, score_card, filenet_ref)
    pipeline.log(request_id, "SUMMARY_GENERATED", ai_summary[:150])

    # Step 6 — Save to MySQL pending table — AI STOPS HERE
    record = ChangeRequest(
        request_id=request_id,
        customer_id=customer_id,
        change_type=change_type,
        old_value=old_value,
        new_value=new_value,
        extracted_data=json.dumps(extracted),
        score_card=json.dumps(score_card),
        ai_summary=ai_summary,
        filenet_ref=filenet_ref,
        status="AI_VERIFIED_PENDING_HUMAN",
        overall_confidence=score_card["overall_confidence"],
        forgery_check=score_card["forgery_check"],
        created_at=datetime.utcnow(),
    )
    db.add(record)
    db.commit()
    pipeline.log(request_id, "STAGED_PENDING", "Status: AI_VERIFIED_PENDING_HUMAN")

    return {
        "request_id":       request_id,
        "status":           "AI_VERIFIED_PENDING_HUMAN",
        "filenet_ref":      filenet_ref,
        "is_duplicate_doc": is_duplicate,
        "score_card":       score_card,
        "ai_summary":       ai_summary,
    }


# ──────────────────────────────────────────────────────────────────────────
# ROUTE 2: List all requests (Checker dashboard)
# ──────────────────────────────────────────────────────────────────────────
@app.get("/api/requests")
def list_requests(status: Optional[str] = None, db: Session = Depends(get_db)):
    q = db.query(ChangeRequest).order_by(ChangeRequest.created_at.desc())
    if status:
        q = q.filter(ChangeRequest.status == status)
    return [r.to_dict() for r in q.all()]


# ──────────────────────────────────────────────────────────────────────────
# ROUTE 3: Get one request
# ──────────────────────────────────────────────────────────────────────────
@app.get("/api/requests/{request_id}")
def get_request(request_id: str, db: Session = Depends(get_db)):
    r = db.query(ChangeRequest).filter(ChangeRequest.request_id == request_id).first()
    if not r:
        raise HTTPException(status_code=404, detail="Not found")
    return r.to_dict()


# ──────────────────────────────────────────────────────────────────────────
# ROUTE 4: Checker APPROVES → RPS write executes
#
# *** HITL ENFORCEMENT ***
# pipeline.rps_write() is called ONLY here.
# The AI pipeline (steps 1-5 above) never calls rps_write().
# A human must explicitly hit this endpoint.
# ──────────────────────────────────────────────────────────────────────────
@app.post("/api/requests/{request_id}/approve")
def approve(
    request_id: str,
    checker_id: str = Query(default="CHECKER_001"),
    db: Session = Depends(get_db),
):
    r = db.query(ChangeRequest).filter(ChangeRequest.request_id == request_id).first()
    if not r:
        raise HTTPException(status_code=404, detail="Not found")
    if r.status != "AI_VERIFIED_PENDING_HUMAN":
        raise HTTPException(status_code=400, detail=f"Cannot approve — status is '{r.status}'")

    # Write to mock RPS — ONLY after human approval
    rps_result = pipeline.rps_write(r.customer_id, r.change_type, r.new_value)

    r.status           = "APPROVED"
    r.checker_id       = checker_id
    r.checker_decision = "APPROVED"
    r.decided_at       = datetime.utcnow()
    db.commit()

    pipeline.log(request_id, "HUMAN_APPROVED",
                 f"checker={checker_id} rps_tx={rps_result['transaction_id']}")

    return {"status": "APPROVED", "rps_result": rps_result}


# ──────────────────────────────────────────────────────────────────────────
# ROUTE 5: Checker REJECTS → no RPS write
# ──────────────────────────────────────────────────────────────────────────
@app.post("/api/requests/{request_id}/reject")
def reject(
    request_id: str,
    checker_id: str = Query(default="CHECKER_001"),
    reason:     str = Query(default=""),
    db: Session = Depends(get_db),
):
    r = db.query(ChangeRequest).filter(ChangeRequest.request_id == request_id).first()
    if not r:
        raise HTTPException(status_code=404, detail="Not found")
    if r.status != "AI_VERIFIED_PENDING_HUMAN":
        raise HTTPException(status_code=400, detail=f"Cannot reject — status is '{r.status}'")

    r.status           = "REJECTED"
    r.checker_id       = checker_id
    r.checker_decision = "REJECTED"
    r.rejection_reason = reason
    r.decided_at       = datetime.utcnow()
    db.commit()

    pipeline.log(request_id, "HUMAN_REJECTED", f"checker={checker_id} reason={reason}")
    return {"status": "REJECTED", "reason": reason}


# ──────────────────────────────────────────────────────────────────────────
# ROUTE 6: Audit log
# ──────────────────────────────────────────────────────────────────────────
@app.get("/api/audit-log")
def audit_log():
    return list(reversed(pipeline.AUDIT_LOG))


@app.get("/api/documents/{request_id}")
def view_document(request_id: str):
    """Serve the uploaded document for a given request (for Checker preview)."""
    store_dir = Path("filenet_store") / request_id
    if not store_dir.exists():
        raise HTTPException(status_code=404, detail="Document not found")
    # Find the document file (exclude metadata JSON files)
    files = [f for f in store_dir.iterdir() if not f.name.endswith("_metadata.json") and f.is_file()]
    if not files:
        raise HTTPException(status_code=404, detail="No document file found")
    doc_file = files[0]
    ext = doc_file.suffix.lower()
    media_type = "application/pdf" if ext == ".pdf" else f"image/{ext.lstrip('.')}"
    return FileResponse(path=str(doc_file), media_type=media_type, filename=doc_file.name)


@app.get("/api/rps/{customer_id}")
def read_rps(customer_id: str):
    record = pipeline.rps_read(customer_id)
    if not record:
        raise HTTPException(status_code=404, detail="Customer not found")
    return {"customer_id": customer_id, "record": record}

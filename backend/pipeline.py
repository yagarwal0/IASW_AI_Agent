"""
pipeline.py — All AI pipeline steps in one place.

The 5 steps the AI performs (in order):
  1. validate()        — check customer exists in mock RPS
  2. store_document()  — save to mock FileNet, check duplicate via ChromaDB
  3. extract()         — OCR with Google Doc AI (or GPT-4o vision fallback)
  4. score()           — confidence scoring per field using difflib
  5. summarize()       — LangChain + GPT-4o generates Checker summary

Step 6 (RPS write) is NOT here — it only happens after human Checker approval.
"""

import os, base64, json, hashlib
from difflib import SequenceMatcher
from datetime import datetime
from pathlib import Path

# LangChain — we use it for the Summary Agent prompt chain
from langchain_openai import ChatOpenAI
from langchain.prompts import ChatPromptTemplate

# ChromaDB — we use it to detect duplicate document submissions
import chromadb

from dotenv import load_dotenv
load_dotenv()

# ─── Mock bank data (stand-in for real RPS) ────────────────────────────────
MOCK_RPS = {
    "C001": {"name": "Priya Sharma",    "address": "Poonch Colony, Jammu",               "dob": "1999-05-15", "email": "priya.sharma@gmail.com"},
    "C002": {"name": "Yash Agarwal",    "address": "Mohalla Hathi Khana, Chandausi",     "dob": "1999-05-05", "email": "yash@iitjammu.com"},
    "C003": {"name": "Neha Sharma",     "address": "IIT Jammu",                          "dob": "2001-11-30", "email": "neha@outlook.com"},
}

FIELD_MAP = {
    "legal_name":    "name",
    "address":       "address",
    "date_of_birth": "dob",
    "contact_email": "email",
}

# ─── Audit log (in-memory) ──────────────────────────────────────────────────
AUDIT_LOG = []

def log(request_id, step, detail):
    entry = {"time": datetime.utcnow().isoformat(), "request_id": request_id,
             "step": step, "detail": str(detail)[:500]}
    AUDIT_LOG.append(entry)
    print(f"[{step}] {str(detail)[:120]}")


# ═══════════════════════════════════════════════════════════════════════════
# STEP 1 — VALIDATION AGENT
# Checks: customer exists, change type is valid, old value matches bank record
# ═══════════════════════════════════════════════════════════════════════════

def validate(customer_id, change_type, old_value):
    if customer_id not in MOCK_RPS:
        return False, f"Customer '{customer_id}' not found in RPS"

    if change_type not in FIELD_MAP:
        return False, f"Unsupported change type: {change_type}"

    rps_value = MOCK_RPS[customer_id][FIELD_MAP[change_type]]
    if rps_value.lower().strip() != old_value.lower().strip():
        return False, f"Old value '{old_value}' does not match RPS record '{rps_value}'"

    if old_value.strip().lower() == "":
        return False, "Old value cannot be empty"

    return True, "OK"


# ═══════════════════════════════════════════════════════════════════════════
# STEP 2 — FILENET MOCK + CHROMADB DUPLICATE DETECTION
# Saves document to local filesystem (mock FileNet).
# ChromaDB stores a hash of each document — if same doc submitted twice, flag it.
# ═══════════════════════════════════════════════════════════════════════════

# ChromaDB client — stores document fingerprints
chroma_client = chromadb.PersistentClient(path="./chroma_store")
doc_collection = chroma_client.get_or_create_collection("document_hashes")

def store_document(request_id, filename, content):
    # Save file to local storage (mock FileNet)
    store_dir = Path("filenet_store") / request_id
    store_dir.mkdir(parents=True, exist_ok=True)
    filenet_ref = f"FN-{datetime.utcnow().strftime('%Y%m%d')}-{request_id[:8].upper()}"
    safe_name = "".join(c if c.isalnum() or c in "._-" else "_" for c in filename)
    with open(store_dir / f"{filenet_ref}_{safe_name}", "wb") as f:
        f.write(content)

    # ChromaDB: check if this exact document was submitted before
    doc_hash = hashlib.sha256(content).hexdigest()
    existing = doc_collection.query(query_texts=[doc_hash], n_results=1)
    is_duplicate = bool(existing["ids"][0]) and existing["ids"][0][0] == doc_hash

    # Store this document's hash so future submissions can be checked
    if not is_duplicate:
        doc_collection.add(documents=[doc_hash], ids=[doc_hash],
                           metadatas=[{"request_id": request_id, "filename": filename}])

    return filenet_ref, is_duplicate


# ═══════════════════════════════════════════════════════════════════════════
# STEP 3 — DOCUMENT PROCESSOR AGENT (OCR + Extraction)
# Tries Google Document AI first. Falls back to GPT-4o vision.
# Returns extracted fields as a dict.
# ═══════════════════════════════════════════════════════════════════════════

# What to extract per change type
EXTRACTION_PROMPTS = {
    "legal_name":    "Extract: document_type, bride_name (old/maiden name), married_name (new name), document_date, issuing_authority, document_number. Return JSON only.",
    "address":       "Extract: document_type, address (full address string), person_name, document_date, issuing_authority. Return JSON only.",
    "date_of_birth": "Extract: document_type, date_of_birth (DD-MM-YYYY format), person_name, document_number, issuing_authority. Return JSON only.",
    "contact_email": "Extract: document_type, email_address, person_name, signature_present (true/false), consent_date. Return JSON only.",
}

def extract(doc_content, filename, change_type):
    # Try Google Document AI if configured
    if os.getenv("GOOGLE_CLOUD_PROJECT") and os.getenv("GOOGLE_DOCAI_PROCESSOR_ID"):
        raw_text = _google_docai_ocr(doc_content, filename)
    else:
        raw_text = None  # will use GPT-4o vision directly

    return _llm_extract(doc_content, filename, raw_text, change_type)


def _google_docai_ocr(content, filename):
    """Call Google Document AI to extract raw text from document."""
    try:
        from google.cloud import documentai
        client = documentai.DocumentProcessorServiceClient()
        name = (f"projects/{os.getenv('GOOGLE_CLOUD_PROJECT')}"
                f"/locations/{os.getenv('GOOGLE_DOCAI_LOCATION','us')}"
                f"/processors/{os.getenv('GOOGLE_DOCAI_PROCESSOR_ID')}")
        mime = "application/pdf" if filename.lower().endswith(".pdf") else "image/jpeg"
        result = client.process_document(request=documentai.ProcessRequest(
            name=name,
            raw_document=documentai.RawDocument(content=content, mime_type=mime)
        ))
        return result.document.text
    except Exception as e:
        print(f"Google Doc AI failed: {e} — falling back to GPT-4o vision")
        return None


def _llm_extract(content, filename, raw_text, change_type):
    """Use GPT-4o to extract structured fields from document."""
    from openai import OpenAI
    openai_client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
    prompt = EXTRACTION_PROMPTS.get(change_type, "Extract all relevant fields as JSON.")
    ext = filename.lower().split(".")[-1]
    is_pdf = ext == "pdf"

    if raw_text:
        # We have text from Google Doc AI — pass it as text to GPT
        messages = [{"role": "user", "content": f"Document text:\n{raw_text}\n\n{prompt}"}]
    elif is_pdf:
        # PDFs not supported by GPT-4o vision — extract text content and send as text
        pdf_text = content.decode("utf-8", errors="ignore")[:4000]
        if len(pdf_text.strip()) < 20:
            # Binary PDF with no readable text — describe what we know
            pdf_text = f"[Binary PDF file: {filename}, size: {len(content)} bytes]"
        messages = [{"role": "user", "content": f"You are a bank document analyzer.\nDocument filename: {filename}\nDocument text content:\n{pdf_text}\n\n{prompt}"}]
    else:
        # Image file — send directly to GPT-4o vision
        mime = f"image/{ext if ext in ('jpeg', 'png', 'gif', 'webp') else 'jpeg'}"
        b64 = base64.b64encode(content).decode()
        messages = [{"role": "user", "content": [
            {"type": "text", "text": f"You are a bank document analyzer. {prompt}"},
            {"type": "image_url", "image_url": {"url": f"data:{mime};base64,{b64}"}}
        ]}]

    response = openai_client.chat.completions.create(model="gpt-4o", messages=messages)
    text = response.choices[0].message.content.strip()

    # Strip markdown code fences if GPT wraps JSON in ```
    if "```" in text:
        text = text.split("```")[1]
        if text.startswith("json"):
            text = text[4:]
    try:
        return json.loads(text.strip())
    except Exception:
        return {"_raw_output": text, "_parse_error": True}


# ═══════════════════════════════════════════════════════════════════════════
# STEP 4 — CONFIDENCE SCORER
# Compares extracted fields vs requested values using string similarity.
# Each field gets: score (0-100%), status (PASS / FLAG / FAIL)
# ═══════════════════════════════════════════════════════════════════════════

def _sim(a, b):
    """String similarity score — 0.0 to 1.0"""
    return SequenceMatcher(None, str(a).lower().strip(), str(b).lower().strip()).ratio()

def _status(pct):
    return "PASS" if pct >= 85 else "FLAG" if pct >= 60 else "FAIL"

def _score_field(extracted_val, requested_val):
    if not extracted_val:
        return {"score": 0, "status": "FAIL", "extracted": None, "requested": requested_val}
    pct = round(_sim(extracted_val, requested_val) * 100, 1)
    return {"score": pct, "status": _status(pct), "extracted": extracted_val, "requested": requested_val}

def score(change_type, old_value, new_value, extracted, is_duplicate=False):
    fields = {}

    if change_type == "legal_name":
        fields["old_name_match"] = _score_field(extracted.get("bride_name") or extracted.get("old_name"), old_value)
        fields["new_name_match"] = _score_field(extracted.get("married_name") or extracted.get("new_name"), new_value)

    elif change_type == "address":
        fields["address_match"] = _score_field(extracted.get("address"), new_value)

    elif change_type == "date_of_birth":
        fields["dob_match"] = _score_field(extracted.get("date_of_birth"), new_value)

    elif change_type == "contact_email":
        fields["email_match"] = _score_field(extracted.get("email_address"), new_value)
        fields["signature_check"] = {
            "score": 100 if extracted.get("signature_present") is True or str(extracted.get("signature_present","")).lower() == "true" else 0,
            "status": "PASS" if str(extracted.get("signature_present","")).lower() == "true" else "FLAG",
        }

    # Document authenticity — check basic markers
    has_date      = bool(extracted.get("document_date") or extracted.get("consent_date"))
    has_authority = bool(extracted.get("issuing_authority"))
    has_doc_num   = bool(extracted.get("document_number"))
    auth_pct      = round(sum([has_date, has_authority, has_doc_num]) / 3 * 100, 1)
    fields["document_authenticity"] = {"score": auth_pct, "status": _status(auth_pct)}

    # Forgery check
    forgery_flags = []
    if not has_doc_num:   forgery_flags.append("missing document number")
    if not has_authority: forgery_flags.append("missing issuing authority")
    if is_duplicate:      forgery_flags.append("duplicate document detected by ChromaDB")
    forgery = "PASS" if not forgery_flags else "FLAG"

    # Overall = average of all field scores
    scores = [v["score"] for v in fields.values() if isinstance(v, dict) and "score" in v]
    overall = round(sum(scores) / len(scores), 1) if scores else 0

    recommendation = "APPROVE" if overall >= 80 and forgery == "PASS" else "REVIEW" if overall >= 60 else "REJECT"

    return {
        "fields":             fields,
        "overall_confidence": overall,
        "forgery_check":      forgery,
        "forgery_indicators": forgery_flags,
        "recommendation":     recommendation,
    }


# ═══════════════════════════════════════════════════════════════════════════
# STEP 5 — SUMMARY AGENT (LangChain + GPT-4o)
# Uses a LangChain prompt template to generate a Checker-readable summary.
# This is where LangChain adds value — structured, reusable prompt chains.
# ═══════════════════════════════════════════════════════════════════════════

# LangChain prompt template — variables filled in at runtime
SUMMARY_PROMPT = ChatPromptTemplate.from_messages([
    ("system", "You are a bank compliance AI. Write concise, professional summaries for human Checker supervisors. Be factual and highlight concerns clearly."),
    ("human", """
Change Type: {change_type}
Customer requested: "{old_value}" → "{new_value}"
FileNet Document Ref: {filenet_ref}

Document Extracted:
{extracted}

Confidence Scores:
- Overall: {overall}%
- Forgery Check: {forgery}
- Recommendation: {recommendation}
- Flags: {flags}

Write a 3-sentence summary:
1. What document was verified and key fields extracted
2. Confidence scores for critical fields and any concerns
3. Clear recommendation with justification
""")
])

# LangChain chain = prompt | LLM
_llm = ChatOpenAI(model="gpt-4o", temperature=0.1)
summary_chain = SUMMARY_PROMPT | _llm

def summarize(change_type, old_value, new_value, extracted, score_card, filenet_ref):
    clean_extracted = {k: v for k, v in extracted.items() if not k.startswith("_")}
    response = summary_chain.invoke({
        "change_type":  change_type.replace("_", " ").title(),
        "old_value":    old_value,
        "new_value":    new_value,
        "filenet_ref":  filenet_ref,
        "extracted":    json.dumps(clean_extracted, indent=2),
        "overall":      score_card["overall_confidence"],
        "forgery":      score_card["forgery_check"],
        "recommendation": score_card["recommendation"],
        "flags":        score_card.get("forgery_indicators", []),
    })
    return response.content


# ═══════════════════════════════════════════════════════════════════════════
# MOCK RPS WRITE — called ONLY after human Checker approval
# This function is not part of the AI pipeline. It lives here as a utility
# but is invoked exclusively from the /approve endpoint in main.py.
# ═══════════════════════════════════════════════════════════════════════════

def rps_write(customer_id, change_type, new_value):
    field = FIELD_MAP[change_type]
    old   = MOCK_RPS[customer_id][field]
    MOCK_RPS[customer_id][field] = new_value
    tx_id = f"RPS-{datetime.utcnow().strftime('%Y%m%d%H%M%S')}-{customer_id}"
    return {"transaction_id": tx_id, "field": field, "old": old, "new": new_value}


def rps_read(customer_id):
    return MOCK_RPS.get(customer_id)

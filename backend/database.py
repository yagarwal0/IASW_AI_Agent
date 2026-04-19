"""
database.py — MySQL table for all change requests (Pending Table)
"""
from sqlalchemy import create_engine, Column, String, Float, DateTime, Text
from sqlalchemy.orm import declarative_base, sessionmaker
from datetime import datetime
import json, os
from dotenv import load_dotenv

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL", "mysql+pymysql://root:abcd@127.0.0.1:3306/iasw_db")
engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(bind=engine)
Base = declarative_base()


class ChangeRequest(Base):
    __tablename__ = "change_requests"

    request_id       = Column(String(36),  primary_key=True)
    customer_id      = Column(String(50))
    change_type      = Column(String(50))   # legal_name | address | date_of_birth | contact_email
    old_value        = Column(String(500))
    new_value        = Column(String(500))
    extracted_data   = Column(Text)          # JSON — what AI read from the document
    score_card       = Column(Text)          # JSON — confidence scores per field
    ai_summary       = Column(Text)          # plain-English summary for Checker
    filenet_ref      = Column(String(200))   # mock FileNet document reference
    status           = Column(String(50), default="AI_VERIFIED_PENDING_HUMAN")
    overall_confidence = Column(Float)
    forgery_check    = Column(String(20))
    checker_id       = Column(String(50))
    checker_decision = Column(String(20))
    rejection_reason = Column(Text)
    created_at       = Column(DateTime, default=datetime.utcnow)
    decided_at       = Column(DateTime)

    def to_dict(self):
        return {
            "request_id":        self.request_id,
            "customer_id":       self.customer_id,
            "change_type":       self.change_type,
            "old_value":         self.old_value,
            "new_value":         self.new_value,
            "extracted_data":    json.loads(self.extracted_data or "{}"),
            "score_card":        json.loads(self.score_card or "{}"),
            "ai_summary":        self.ai_summary,
            "filenet_ref":       self.filenet_ref,
            "status":            self.status,
            "overall_confidence": self.overall_confidence,
            "forgery_check":     self.forgery_check,
            "checker_id":        self.checker_id,
            "checker_decision":  self.checker_decision,
            "rejection_reason":  self.rejection_reason,
            "created_at":        self.created_at.isoformat() if self.created_at else None,
            "decided_at":        self.decided_at.isoformat() if self.decided_at else None,
        }


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db():
    Base.metadata.create_all(bind=engine)

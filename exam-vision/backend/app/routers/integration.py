# backend/app/routers/integration.py
"""Holy Sai integration: the Holy Sai API pushes its student roster and marking staff here.

Only active when EXAM_GATEWAY_SECRET is set. The request is signed with
HMAC-SHA256(secret, "sync\\n<ts>\\n<sha256 of the body>") in X-HS-Sig, X-HS-Ts.
"""

from __future__ import annotations

import hashlib
import hmac
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field, ValidationError
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import STARTED_AT, settings
from ..db import get_db
from ..models import Student, User
from ..security import GATEWAY_ROLES, audit, gateway_fresh, gateway_signature, gateway_user_id

router = APIRouter(prefix="/api/integration", tags=["integration"])
DB = Annotated[Session, Depends(get_db)]


class RosterStudent(BaseModel):
    admission_no: str = Field(min_length=1, max_length=32)
    name: str = Field(min_length=1, max_length=120)
    class_name: str = Field(min_length=1, max_length=60)
    section: str = Field(default="", max_length=10)
    roll_no: str = Field(default="", max_length=10)


class RosterStaff(BaseModel):
    id: str = Field(min_length=32, max_length=36)  # Holy Sai user id (UUID)
    name: str = Field(min_length=1, max_length=120)
    role: str


class Roster(BaseModel):
    students: list[RosterStudent]
    staff: list[RosterStaff]


async def signed_body(request: Request) -> bytes:
    if not settings.integrated:
        raise HTTPException(404, "Not found.")
    body = await request.body()
    ts, sig = request.headers.get("x-hs-ts", ""), request.headers.get("x-hs-sig", "")
    expected = gateway_signature("sync", ts, hashlib.sha256(body).hexdigest())
    if not gateway_fresh(ts) or not hmac.compare_digest(expected, sig):
        raise HTTPException(401, "Bad signature.")
    return body


@router.post("/sync")
def sync(body: Annotated[bytes, Depends(signed_body)], db: DB) -> dict:
    """Upserts students by admission number and staff by Holy Sai user id.
    Staff missing from the list are disabled; students are never deleted (sheets refer to them)."""
    try:
        roster = Roster.model_validate_json(body)
    except ValidationError as exc:
        raise HTTPException(422, exc.errors(include_url=False)) from None
    existing = {s.admission_no: s for s in db.scalars(select(Student))}
    created = updated = 0
    for row in roster.students:
        s = existing.get(row.admission_no.strip())
        if s is None:
            s = Student(admission_no=row.admission_no.strip())
            db.add(s)
            existing[s.admission_no] = s
            created += 1
        elif (s.name, s.class_name, s.section, s.roll_no) != (row.name, row.class_name, row.section, row.roll_no):
            updated += 1
        s.name, s.class_name, s.section, s.roll_no = row.name, row.class_name, row.section, row.roll_no

    users = {u.id: u for u in db.scalars(select(User).where(User.username.like("hs:%")))}
    seen = set()
    for row in roster.staff:
        if row.role not in GATEWAY_ROLES:
            continue
        uid = gateway_user_id(row.id)
        seen.add(uid)
        u = users.get(uid)
        if u is None:
            db.add(User(id=uid, username=f"hs:{row.id}", name=row.name, role=row.role, password_hash="!", active=True))
        else:
            u.name, u.role, u.active = row.name, row.role, True
    disabled = 0
    for uid, u in users.items():
        if uid not in seen and u.active:
            u.active = False
            disabled += 1
    audit(db, None, "roster_synced", "student", None, created=created, updated=updated,
          staff=len(seen), staff_disabled=disabled)
    db.commit()
    return {"students_created": created, "students_updated": updated, "staff": len(seen), "staff_disabled": disabled,
            "started": STARTED_AT}

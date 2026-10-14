# backend/app/demo.py
"""Builds the Paper Correction demo (app/demo_content.py) when EXAM_DEMO=1.

Runs after each roster sync from Holy Sai, so the students exist. If the demo exams are
already there it does nothing; on a host whose disk is wiped on restart (Render free) the
demo is therefore rebuilt automatically after every restart.

The records are what a real run leaves behind: the sheet image, one Claude reading, each
answer's transcription, one AI evaluation per answer (marks per criterion, evidence,
strengths, misconceptions, review flags) and the teacher's approvals and overrides. No
Claude call is made. Everything is SAMPLE data.
"""

from __future__ import annotations

import datetime as dt
import hashlib
import io
import logging
import os
from pathlib import Path

from PIL import Image
from sqlalchemy import select
from sqlalchemy.orm import Session

from .config import settings
from .demo_content import CLASS, EXAMS, FEEDBACK_FULL, FEEDBACK_PART, FEEDBACK_ZERO, SECTION
from .models import (
    Answer, Evaluation, Exam, ExamTeacher, Extraction, MarkOverride, Page, Question, RubricVersion, Student, Submission,
    User, now,
)
from .security import audit
from .services import prompts
from .services.documents import quality, to_png

log = logging.getLogger(__name__)
SHEETS = Path(__file__).resolve().parent / "demo_sheets"
MODEL = "claude-opus-5-5"


def enabled() -> bool:
    return os.getenv("EXAM_DEMO", "") == "1"


def _ago(minutes: int) -> dt.datetime:
    return now() - dt.timedelta(minutes=minutes)


def _evidence(text: str, award: float) -> str:
    return text.split("\n")[0].strip() if award > 0 else ""


def ensure_demo(db: Session) -> list[str]:
    """Creates any demo exam that is missing. Returns the names created."""
    if not enabled():
        return []
    created = []
    for spec in EXAMS:
        if db.scalars(select(Exam).where(Exam.name == spec["name"], Exam.class_name == CLASS)).first():
            continue
        students = {s.admission_no: s for s in db.scalars(select(Student).where(
            Student.admission_no.in_([sh["no"] for sh in spec["sheets"]])))}
        if len(students) < len(spec["sheets"]):
            log.info("demo %s skipped: its students are not in the roster yet", spec["key"])
            continue
        _build(db, spec, students)
        created.append(spec["name"])
    if created:
        db.commit()
        log.info("demo exams created: %s", ", ".join(created))
    return created


def _build(db: Session, spec: dict, students: dict[str, Student]) -> None:
    teacher = db.scalars(select(User).where(User.role == "teacher", User.name.contains(spec["teacher"]))).first()
    approver = teacher.id if teacher else None
    exam = Exam(name=spec["name"], academic_year=_year(), class_name=CLASS, section=SECTION, subject=spec["subject"],
                grade_level=spec["grade_level"], instructions=spec["instructions"], results_status=spec["results"],
                created_at=_ago(60 * 26))
    db.add(exam)
    db.flush()
    if teacher:
        db.add(ExamTeacher(exam_id=exam.id, user_id=teacher.id))

    questions: dict[str, Question] = {}
    rubrics: dict[str, dict] = {}
    for order, q in enumerate(spec["questions"], start=1):
        question = Question(exam_id=exam.id, number=q["number"], order=order, text=q["text"], qtype=q.get("qtype", "science"),
                            max_marks=q["max"], mark_increment=1, numeric_answer=q.get("numeric"), numeric_tolerance=0,
                            unit=q.get("unit"), current_rubric_version=1)
        db.add(question)
        db.flush()
        criteria = [{"id": cid, "name": name, "max_marks": m, "description": ""} for cid, name, m in q["criteria"]]
        db.add(RubricVersion(question_id=question.id, version=1, reference_answer=q["ref"], criteria=criteria,
                             expected_concepts=q["concepts"], alternatives=q["alt"], misconceptions=q["misc"],
                             partial_credit_rules="Marks per criterion; method marks stand even if the final answer is wrong.",
                             ignore_criteria="Spelling and handwriting", source="teacher", created_by=approver,
                             created_at=_ago(60 * 25)))
        questions[q["number"]], rubrics[q["number"]] = question, {**q, "criteria": criteria}

    for i, sheet in enumerate(spec["sheets"]):
        student = students[sheet["no"]]
        image = Image.open(SHEETS / f"{spec['key']}-{sheet['no']}.jpg").convert("RGB")
        png = to_png(image)
        uploaded = _ago(60 * 24 - i * 3)
        sub = Submission(exam_id=exam.id, student_id=student.id, file_sha256=hashlib.sha256(png).hexdigest(),
                         original_filename=f"{sheet['no']}.pdf", page_count=1, identity_verified=True,
                         identity_verified_by=approver, uploaded_by=approver, created_at=uploaded,
                         status="approved" if sheet["approved"] else "evaluated")
        db.add(sub)
        db.flush()
        folder = settings.upload_dir / sub.id
        folder.mkdir(parents=True, exist_ok=True)
        (folder / "page-1.png").write_bytes(png)
        db.add(Page(submission_id=sub.id, page_no=1, image_path=str(folder / "page-1.png"), width=image.width,
                    height=image.height, quality=quality(image)))

        answers_text = {n: a[0] for n, a in sheet["answers"].items()}
        full_text = "\n".join(f"{n}. {t}" for n, t in answers_text.items())
        ext = Extraction(submission_id=sub.id, provider="claude", model=MODEL, status="done",
                         pages=[{"page_no": 1, "text": full_text, "warnings": [], "uncertain": [], "confidence": None,
                                 "duration_ms": 9000 + i * 700}],
                         warnings=[], answers={n: {"text": t, "pages": [1], "uncertain": []} for n, t in answers_text.items()},
                         unassigned_text="", name_on_sheet=student.name, duration_ms=9000 + i * 700,
                         usage={"input_tokens": 2400 + i * 37, "output_tokens": 380 + i * 11},
                         requested_by=approver, created_at=uploaded + dt.timedelta(minutes=1))
        db.add(ext)
        db.flush()
        sub.active_extraction_id = ext.id

        for n, (text, awards, notes) in sheet["answers"].items():
            _answer(db, sub, ext, questions[n], rubrics[n], text, awards, notes, approved=sheet["approved"],
                    approver=approver, at=uploaded + dt.timedelta(minutes=2))
    audit(db, approver, "demo_exam_created", "exam", exam.id, sheets=len(spec["sheets"]))


def _answer(db: Session, sub: Submission, ext: Extraction, q: Question, rub: dict, text: str, awards: list,
            notes: dict, *, approved: bool, approver: str | None, at: dt.datetime) -> None:
    crits = rub["criteria"]
    why = notes.get("why", "")
    whys = why if isinstance(why, list) else [why] * len(crits)
    rows = [{"criterion_id": c["id"], "criterion_name": c["name"], "maximum_marks": c["max_marks"],
             "awarded_marks": float(a), "evidence": _evidence(text, a),
             "explanation": "Meets the criterion." if a >= c["max_marks"] else (whys[k] or "Not shown in the answer.")}
            for k, (c, a) in enumerate(zip(crits, awards))]
    suggested = float(sum(awards))
    review = notes.get("review")
    checks = [{"check": "total", "ok": True, "detail": f"criteria add up to {suggested}"}]
    if rub.get("numeric"):
        found = rub["numeric"] in text.replace(" ", "")
        checks.append({"check": "final_answer", "ok": found,
                       "detail": f"expected {rub['numeric']}{(' ' + rub['unit']) if rub.get('unit') else ''}; "
                                 f"{'found in the answer' if found else 'not found in the answer'}"})
    result = {"question_id": q.number, "maximum_marks": q.max_marks, "suggested_marks": suggested, "criteria": rows,
              "strengths": notes.get("good", []), "missing_concepts": notes.get("miss", []),
              "misconceptions": notes.get("mis", []), "student_final_answer": text.split("\n")[-1],
              "ocr_status": "verified" if approved else "unverified", "evaluation_confidence": None,
              "requires_teacher_review": bool(review), "review_reasons": [review] if review else []}
    answer = Answer(submission_id=sub.id, question_id=q.id, extraction_id=ext.id, original_text=text, page_refs=[1],
                    ocr_status="verified" if approved else "unverified", flags=[])
    db.add(answer)
    db.flush()
    ev = Evaluation(answer_id=answer.id, rubric_version=1, prompt_version=prompts.PROMPT_VERSION, provider="claude",
                    model=MODEL, status="ok", result=result, suggested_marks=suggested, requires_review=bool(review),
                    review_reasons=result["review_reasons"], checks=checks, answer_text_used=text,
                    usage={"input_tokens": 1150, "output_tokens": 290}, duration_ms=4200, requested_by=approver, created_at=at)
    db.add(ev)
    db.flush()
    answer.current_evaluation_id = ev.id
    final = {c["id"]: float(a) for c, a in zip(crits, awards)}
    teacher_change = notes.get("teacher")
    if approved and teacher_change:
        new_awards, reason = teacher_change
        new = {c["id"]: float(a) for c, a in zip(crits, new_awards)}
        db.add(MarkOverride(answer_id=answer.id, original_marks=suggested, new_marks=float(sum(new_awards)),
                            original_criteria=final, new_criteria=new, reason=reason, user_id=approver or "demo",
                            created_at=at + dt.timedelta(hours=20)))
        final = new
    answer.criterion_marks = final
    answer.final_marks = float(sum(final.values()))
    if approved:
        answer.mark_status = "approved"
        answer.approved_by, answer.approved_at = approver, at + dt.timedelta(hours=21)
        share = answer.final_marks / q.max_marks
        answer.feedback = FEEDBACK_FULL if share >= 1 else FEEDBACK_PART if share > 0 else FEEDBACK_ZERO
    else:
        answer.mark_status = "needs_review" if review else "suggested"


def _year() -> str:
    today = dt.date.today()
    start = today.year if today.month >= 6 else today.year - 1
    return f"{start}-{str(start + 1)[-2:]}"

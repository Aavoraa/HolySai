"""Approved and teacher-entered marks survive marking jobs; stale marks cannot be approved."""

import pytest
from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError

from app import db
from app.models import Answer, Extraction, Job, MarkOverride, now
from app.security import gateway_fresh
from app.services import jobs, scoring

from .conftest import FakeEvaluator, FakeReader, full_marks

GOOD = {"name": "Arun Kumar", "answers": {"1": "Plants use light energy to make their own food.",
                                          "2": "speed = 120 / 2 = 60 km/h"}}


def _sheet(world, sub_id):
    return world.c.get(f"/api/submissions/{sub_id}", headers=world.teacher).json()


def _answer(world, sub_id, number="1"):
    return next(r["answer"] for r in _sheet(world, sub_id)["questions"] if r["question"]["number"] == number)


def _marked_sheet(world):
    FakeReader.SHEET = GOOD
    sub = world.upload(world.s1).json()
    world.c.post(f"/api/submissions/{sub['id']}/identity", headers=world.teacher, json={"verified": True})
    return sub


def _approve(world, aid):
    return world.c.post(f"/api/answers/{aid}/approve", headers=world.teacher, json={})


def test_forced_sheet_evaluation_never_touches_approved_marks(world):
    sub = _marked_sheet(world)
    aid = _answer(world, sub["id"])["id"]
    world.c.put(f"/api/answers/{aid}/marks", headers=world.teacher,
                json={"criterion_marks": {"C1": 1, "C2": 0}, "reason": "food part missing"})
    assert _approve(world, aid).status_code == 200
    calls = len(FakeEvaluator.calls)
    r = world.c.post(f"/api/submissions/{sub['id']}/evaluate", headers=world.teacher, json={"force": True})
    assert r.status_code == 200
    a = _answer(world, sub["id"])
    assert a["mark_status"] == "approved" and a["final_marks"] == 1
    assert len(FakeEvaluator.calls) == calls + 1  # only question 2 was marked again


def test_an_approval_made_while_claude_is_marking_wins(world):
    sub = _marked_sheet(world)
    aid = _answer(world, sub["id"])["id"]

    def approve_meanwhile(message, schema):
        with db.new_session() as s:  # the teacher, in another request
            a = s.get(Answer, aid)
            a.mark_status, a.approved_at = "approved", now()
            s.commit()
        out = full_marks(message, schema)
        for c in out["criteria"]:
            c["awarded_marks"] = 0
        out["suggested_marks"] = 0
        return out

    FakeEvaluator.responder = approve_meanwhile
    assert world.c.post(f"/api/answers/{aid}/evaluate", headers=world.teacher).status_code == 200
    a = _answer(world, sub["id"])
    assert a["mark_status"] == "approved" and a["final_marks"] == 2
    history = world.c.get(f"/api/answers/{aid}/history", headers=world.teacher).json()
    assert len(history["evaluations"]) == 2  # the late marking is kept in the history, not applied


def test_re_marking_over_teacher_marks_is_recorded(world):
    sub = _marked_sheet(world)
    aid = _answer(world, sub["id"])["id"]
    world.c.put(f"/api/answers/{aid}/marks", headers=world.teacher,
                json={"criterion_marks": {"C1": 1, "C2": 0}, "reason": "food part missing"})
    world.c.post(f"/api/exams/{world.exam['id']}/reevaluate", headers=world.teacher, json={})
    a = _answer(world, sub["id"])
    assert a["final_marks"] == 2 and any("replaced the teacher's marks (1)" in f for f in a["flags"])
    with db.new_session() as s:
        reasons = [o.reason for o in s.scalars(select(MarkOverride).where(MarkOverride.answer_id == aid))]
    assert reasons == ["food part missing", "replaced by AI re-marking"]


def test_corrected_text_must_be_re_marked_before_approval(world):
    sub = _marked_sheet(world)
    aid = _answer(world, sub["id"])["id"]
    world.c.patch(f"/api/answers/{aid}/text", headers=world.teacher, json={"text": "Plants make food from light."})
    assert _answer(world, sub["id"])["mark_status"] == "pending"
    assert _approve(world, aid).status_code == 409
    world.c.post(f"/api/submissions/{sub['id']}/evaluate", headers=world.teacher, json={"force": False})
    assert _answer(world, sub["id"])["mark_status"] == "suggested"  # a pending answer is not skipped
    assert _approve(world, aid).status_code == 200


def test_lowering_the_maximum_blocks_approval_of_old_marks(world):
    sub = _marked_sheet(world)
    aid = _answer(world, sub["id"])["id"]
    q = world.q1
    r = world.c.put(f"/api/questions/{q['id']}", headers=world.admin,
                    json={"number": q["number"], "text": q["text"], "max_marks": 1})
    assert r.status_code == 200, r.text
    assert _answer(world, sub["id"])["mark_status"] == "pending"
    assert _approve(world, aid).status_code == 409


def test_the_student_cannot_change_once_marks_are_approved(world):
    sub = _marked_sheet(world)
    assert _approve(world, _answer(world, sub["id"])["id"]).status_code == 200
    move = world.c.post(f"/api/submissions/{sub['id']}/identity", headers=world.teacher,
                        json={"verified": True, "student_id": world.s2["id"]})
    unverify = world.c.post(f"/api/submissions/{sub['id']}/identity", headers=world.teacher, json={"verified": False})
    assert move.status_code == 409 and unverify.status_code == 409


def test_nan_marks_are_refused(world):
    sub = _marked_sheet(world)
    aid = _answer(world, sub["id"])["id"]
    r = world.c.put(f"/api/answers/{aid}/marks", headers={**world.teacher, "Content-Type": "application/json"},
                    content='{"criterion_marks": {"C1": NaN, "C2": 1}, "reason": "x"}')
    assert r.status_code == 400


def test_one_active_job_per_sheet(world, monkeypatch):
    sub = world.upload(world.s1, auto=False).json()
    with db.new_session() as s:
        s.add(Job(kind="process", submission_id=sub["id"]))
        s.commit()
        s.add(Job(kind="evaluate", submission_id=sub["id"]))
        with pytest.raises(IntegrityError):
            s.commit()
        s.rollback()
        real, seen = jobs.active_job, []

        def first_misses(*a, **k):  # the race: the check ran before the other request's insert
            seen.append(1)
            return None if len(seen) == 1 else real(*a, **k)

        monkeypatch.setattr(jobs, "active_job", first_misses)
        job, created = jobs.enqueue(s, "evaluate", sub["id"])
        assert created is False and job.kind == "process"


def test_upgrading_settles_duplicate_active_jobs_then_adds_the_index(world):
    sub = world.upload(world.s1, auto=False).json()
    eng = db.engine()
    prefix = f"{db.PG_SCHEMA}." if eng.dialect.name == "postgresql" else ""
    with eng.begin() as conn:  # a database from before version 4
        conn.execute(text(f"DROP INDEX {prefix}ux_jobs_one_active"))
        conn.execute(text(f"UPDATE {prefix}schema_version SET version = 3"))
    with db.new_session() as s:
        s.add_all([Job(kind="process", submission_id=sub["id"]), Job(kind="evaluate", submission_id=sub["id"])])
        s.commit()
    db.migrate(eng)
    with db.new_session() as s:
        statuses = sorted(j.status for j in s.scalars(select(Job).where(Job.submission_id == sub["id"])))
        assert statuses == ["failed", "queued"]
        s.add(Job(kind="evaluate", submission_id=sub["id"]))
        with pytest.raises(IntegrityError):
            s.commit()


def test_an_unexpected_reading_error_does_not_leave_it_running(world, monkeypatch):
    def broken(self, images, questions):
        raise RuntimeError("image could not be decoded")

    monkeypatch.setattr(FakeReader, "read_sheet", broken)
    sub = world.upload(world.s1).json()
    with db.new_session() as s:
        [ext] = s.scalars(select(Extraction).where(Extraction.submission_id == sub["id"]))
        assert ext.status == "failed" and "decoded" in ext.error
    assert _sheet(world, sub["id"])["status"] == "needs_attention"


def test_units_and_exponents_are_not_the_final_answer():
    assert scoring.check_numeric_answer("g = 9.8 m/s^2", "9.8", 0.01, "m/s^2")["ok"] is True
    assert scoring.check_numeric_answer("area = 25 cm^2", "25", 0.01, None)["ok"] is True


def test_an_absurd_gateway_timestamp_is_refused_not_a_crash():
    assert gateway_fresh("9" * 400) is False

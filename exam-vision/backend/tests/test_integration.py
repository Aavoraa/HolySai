"""Running as the Holy Sai module: signed gateway identity and roster sync."""

import base64
import hashlib
import json
import time

import pytest

from app.config import settings
from app.security import gateway_signature

from .conftest import FakeReader, page_png

SECRET = "test-gateway-secret-0123456789abcdef"
PRINCIPAL = "11111111-2222-3333-4444-555555555555"
TEACHER = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"


@pytest.fixture
def integrated(monkeypatch):
    monkeypatch.setattr(settings, "gateway_secret", SECRET)


def who(user_id: str, role: str, name: str, ts: int | None = None, sig: str | None = None) -> dict:
    name_b64 = base64.urlsafe_b64encode(name.encode()).decode().rstrip("=")
    ts_s = str(ts if ts is not None else int(time.time()))
    return {"X-HS-User": user_id, "X-HS-Role": role, "X-HS-Name": name_b64, "X-HS-Ts": ts_s,
            "X-HS-Sig": sig or gateway_signature(user_id, role, name_b64, ts_s)}


def sync(client, roster: dict, sig: str | None = None):
    body = json.dumps(roster).encode()
    ts = str(int(time.time()))
    return client.post("/api/integration/sync", content=body, headers={
        "Content-Type": "application/json", "X-HS-Ts": ts,
        "X-HS-Sig": sig or gateway_signature("sync", ts, hashlib.sha256(body).hexdigest())})


ROSTER = {
    "students": [{"admission_no": "HS-1", "name": "Aditya Kumar", "class_name": "Grade 5 · GDV", "section": "A", "roll_no": "1"},
                 {"admission_no": "HS-2", "name": "Surya Kumar", "class_name": "Grade 7 · GDV", "section": "B", "roll_no": "4"}],
    "staff": [{"id": TEACHER, "name": "Ms. Priya Raghavan", "role": "teacher"}],
}


def test_signed_identity_signs_in_and_local_accounts_are_off(client, integrated):
    me = client.get("/api/auth/me", headers=who(PRINCIPAL, "coordinator", "Dr. Meera Krishnan"))
    assert me.status_code == 200 and me.json()["role"] == "coordinator" and me.json()["name"] == "Dr. Meera Krishnan"
    assert client.get("/api/auth/me").status_code == 401  # no identity
    bad = who(PRINCIPAL, "admin", "x", sig="0" * 64)
    assert client.get("/api/auth/me", headers=bad).status_code == 401  # forged role
    stale = who(PRINCIPAL, "coordinator", "x", ts=int(time.time()) - 3600)
    assert client.get("/api/auth/me", headers=stale).status_code == 401  # replayed
    assert client.get("/api/auth/me", headers=who(PRINCIPAL, "student", "x")).status_code == 403
    assert client.post("/api/auth/setup", json={"username": "x", "name": "x", "password": "password1"}).status_code == 404
    assert client.post("/api/auth/login", json={"username": "x", "password": "x"}).status_code == 404
    assert client.get("/api/auth/status").json()["integrated"] is True


def test_roster_sync_and_teacher_scope(client, integrated):
    assert sync(client, ROSTER, sig="0" * 64).status_code == 401
    r = sync(client, ROSTER)
    assert r.status_code == 200, r.text
    assert r.json()["students_created"] == 2 and r.json()["staff"] == 1
    again = sync(client, {**ROSTER, "students": [{**ROSTER["students"][0], "name": "Aditya K"}]}).json()
    assert again["students_created"] == 0 and again["students_updated"] == 1

    principal = who(PRINCIPAL, "coordinator", "Principal")
    teacher = who(TEACHER, "teacher", "Ms. Priya Raghavan")
    users = client.get("/api/users", headers=principal).json()
    t = next(u for u in users if u["role"] == "teacher")
    assert t["name"] == "Ms. Priya Raghavan"
    exam = client.post("/api/exams", headers=principal, json={
        "name": "Unit Test", "academic_year": "2026-27", "class_name": "Grade 5 · GDV", "section": "A",
        "subject": "Science"}).json()
    # an unassigned teacher sees no exams and no students
    assert client.get("/api/exams", headers=teacher).json() == []
    assert client.get("/api/students", headers=teacher).json() == []
    assert client.put(f"/api/exams/{exam['id']}/teachers", headers=principal,
                      json={"user_ids": [t["id"]]}).status_code == 200
    assert [e["id"] for e in client.get("/api/exams", headers=teacher).json()] == [exam["id"]]
    assert [s["admission_no"] for s in client.get("/api/students", headers=teacher).json()] == ["HS-1"]

    # staff dropped from the roster are disabled until Holy Sai vouches for them again
    # (the principal too, who is not in this roster; their next signed request re-enables them)
    assert sync(client, {**ROSTER, "staff": []}).json()["staff_disabled"] == 2
    assert next(u for u in client.get("/api/users", headers=principal).json() if u["id"] == t["id"])["active"] is False


def test_teacher_uploads_through_gateway(client, integrated):
    sync(client, ROSTER)
    admin = who(PRINCIPAL, "admin", "Admin")
    client.put("/api/settings/ai", headers=admin, json={"changes": {
        "claude_enabled": True, "claude_api_key": "sk-ant-test", "external_processing_acknowledged": True}})
    exam = client.post("/api/exams", headers=admin, json={
        "name": "UT", "academic_year": "2026-27", "class_name": "Grade 5 · GDV", "section": "A", "subject": "Science"}).json()
    student = client.get("/api/students", headers=admin, params={"class_name": "Grade 5 · GDV"}).json()[0]
    FakeReader.SHEET = {"name": "Aditya Kumar", "answers": {}}
    r = client.post(f"/api/exams/{exam['id']}/submissions", headers=admin,
                    data={"student_id": student["id"], "auto_process": "false"},
                    files=[("files", ("p1.png", page_png(), "image/png"))])
    assert r.status_code == 200, r.text


def test_server_defaults_survive_an_empty_database(client, integrated, monkeypatch):
    """Hosts that wipe the disk (Render free): the key and acknowledgement come from the environment."""
    admin = who(PRINCIPAL, "admin", "Admin")
    assert client.get("/api/settings/ai/status", headers=admin).json()["reading_available"] is False
    monkeypatch.setenv("EXAM_CLAUDE_API_KEY", "sk-ant-from-env")
    monkeypatch.setenv("EXAM_EXTERNAL_PROCESSING_ACKNOWLEDGED", "1")
    assert client.get("/api/settings/ai/status", headers=admin).json()["reading_available"] is True
    cfg = client.get("/api/settings/ai", headers=admin).json()["config"]
    assert cfg["claude_api_key"].endswith("-env") and cfg["claude_enabled"] is True
    # what an administrator saves still wins
    client.put("/api/settings/ai", headers=admin, json={"changes": {"claude_enabled": False}})
    assert client.get("/api/settings/ai/status", headers=admin).json()["reading_available"] is False
    assert isinstance(client.get("/api/health").json()["started"], int)


def test_demo_exams_are_built_once_after_the_roster_sync(client, integrated, monkeypatch):
    monkeypatch.setenv("EXAM_DEMO", "1")
    names = {"HS-2026-1041": "Aditya Kumar", "HS-2026-1055": "Bhavana Iyer", "HS-2026-1058": "Dinesh Selvam",
             "HS-2026-1076": "Nithya Venkatesh", "HS-2026-1082": "Reshma Chandran", "HS-2026-1085": "Surya Kumar"}
    roster = {"students": [{"admission_no": no, "name": n, "class_name": "Grade 5 · GDV", "section": "A", "roll_no": str(i)}
                           for i, (no, n) in enumerate(names.items(), start=1)],
              "staff": [{"id": TEACHER, "name": "Ms. Priya Raghavan", "role": "teacher"},
                        {"id": PRINCIPAL, "name": "Mr. Ganesh Venkat", "role": "teacher"}]}
    assert sync(client, roster).json()["demo_exams_created"] == 2
    assert sync(client, roster).json()["demo_exams_created"] == 0  # idempotent

    admin = who("99999999-2222-3333-4444-555555555555", "admin", "Admin")
    exams = {e["name"]: e for e in client.get("/api/exams", headers=admin).json()}
    sci, maths = exams["Unit Test 2 — Science"], exams["Unit Test 2 — Mathematics"]
    assert sci["results_status"] == "published" and sci["counts"]["approved"] == 5
    assert maths["counts"]["submissions"] == 5 and maths["counts"]["pending_review"] == 2

    report = client.get(f"/api/exams/{sci['id']}/report", headers=admin).json()
    totals = {s["name"]: s["total"] for s in report["students"]}
    assert totals == {"Aditya Kumar": 9, "Bhavana Iyer": 8, "Dinesh Selvam": 6, "Nithya Venkatesh": 7, "Reshma Chandran": 6}
    assert report["overrides"]["count"] == 1  # Reshma Q3: the teacher accepted her own-words answer
    assert any("roots" in m for m, _ in report["common_misconceptions"])

    # the Maths teacher sees only Maths; sheets open with their page image
    priya = who(TEACHER, "teacher", "Ms. Priya Raghavan")
    assert [e["name"] for e in client.get("/api/exams", headers=priya).json()] == ["Unit Test 2 — Mathematics"]
    sub = client.get(f"/api/exams/{maths['id']}/submissions", headers=priya).json()[0]
    sheet = client.get(f"/api/submissions/{sub['id']}", headers=priya).json()
    assert sheet["name_check"]["status"] == "match" and len(sheet["questions"]) == 5
    img = client.get(f"/api/pages/{sheet['page_list'][0]['id']}/image", headers=priya)
    assert img.status_code == 200 and img.content[:4] == b"\x89PNG"

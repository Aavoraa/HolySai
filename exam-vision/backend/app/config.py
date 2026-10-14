# backend/app/config.py
"""Runtime paths and process-level settings.

AI provider settings (URLs, models, API keys) are NOT here: administrators set them in
Settings -> AI Configuration and they are stored in the database (keys encrypted).
"""

import os
import time
from dataclasses import dataclass, field
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent  # backend/


def _load_env_file(path: Path) -> None:
    if not path.is_file():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            key, value = line.split("=", 1)
            os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


_load_env_file(BASE_DIR / ".env")


@dataclass
class Settings:
    data_dir: Path = field(default_factory=lambda: Path(os.getenv("EXAM_DATA_DIR", BASE_DIR / "data")))
    port: int = int(os.getenv("EXAM_PORT", "8006"))
    max_upload_bytes: int = int(os.getenv("EXAM_MAX_UPLOAD", 40 * 1024 * 1024))
    max_pages: int = int(os.getenv("EXAM_MAX_PAGES", "40"))
    session_hours: int = int(os.getenv("EXAM_SESSION_HOURS", "12"))
    workers: int = int(os.getenv("EXAM_WORKERS", "2"))
    run_jobs: bool = os.getenv("EXAM_RUN_JOBS", "1") == "1"  # tests run jobs inline instead
    # Shared with the Holy Sai API. When set, EXAM Vision runs as a module of Holy Sai: every request
    # must carry an identity signed by the Holy Sai API, and local sign-in is switched off.
    gateway_secret: str = os.getenv("EXAM_GATEWAY_SECRET", "")
    # Postgres for hosts without a persistent disk (e.g. Render free + Supabase): everything,
    # page images included, lives in its own "exam_vision" schema. Empty = SQLite in data_dir.
    database_url: str = os.getenv("EXAM_DATABASE_URL", "")

    @property
    def integrated(self) -> bool:
        return bool(self.gateway_secret)

    @property
    def db_path(self) -> Path:
        return self.data_dir / "exam.db"

    @property
    def upload_dir(self) -> Path:
        return self.data_dir / "sheets"

    @property
    def secret_key_path(self) -> Path:
        return self.data_dir / "secret.key"


settings = Settings()
# Lets the Holy Sai API notice a restart (on hosts without a persistent disk, a restart also
# means an empty database that needs the roster again).
STARTED_AT = int(time.time())


def ensure_dirs(s: Settings = settings) -> None:
    s.data_dir.mkdir(parents=True, exist_ok=True)
    s.upload_dir.mkdir(parents=True, exist_ok=True)

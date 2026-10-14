# backend/app/services/page_store.py
"""Page images: kept in the database (page_images) so they survive hosts that wipe the disk;
the file at Page.image_path is only a cache, rebuilt from the database when missing."""

from __future__ import annotations

from pathlib import Path

from sqlalchemy.orm import Session

from ..models import Page, PageImage


def save(db: Session, page: Page, png: bytes) -> None:
    """Stores ``png`` for a flushed ``page`` (in the database, and in the file cache)."""
    row = db.get(PageImage, page.id)
    if row is None:
        db.add(PageImage(page_id=page.id, data=png))
    else:
        row.data = png
    path = Path(page.image_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(png)


def read(db: Session, page: Page) -> bytes:
    path = Path(page.image_path)
    if path.is_file():
        return path.read_bytes()
    row = db.get(PageImage, page.id)
    if row is None:
        raise FileNotFoundError(f"page {page.id} has no stored image")
    try:  # refill the cache
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(row.data)
    except OSError:
        pass
    return bytes(row.data)

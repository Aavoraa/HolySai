# EXAM Vision — Paper Correction service for Holy Sai (Claude reads and marks answer sheets).
# Runs behind the Holy Sai API; never expose this port publicly.
FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 EXAM_DATA_DIR=/data
WORKDIR /app
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY backend/app app
COPY backend/static static
RUN useradd -r app && mkdir -p /data && chown app /data
USER app
EXPOSE 8006
CMD ["python", "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8006"]

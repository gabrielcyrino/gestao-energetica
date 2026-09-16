FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app
COPY db ./db
COPY entrypoint.sh ./
RUN chmod +x entrypoint.sh && useradd -m energia && chown -R energia /app
USER energia

EXPOSE 6472
CMD ["./entrypoint.sh"]

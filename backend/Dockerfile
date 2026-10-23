FROM denoland/deno:bin-2.6.2 AS deno
FROM python:3.12-slim
COPY --from=deno /deno /usr/local/bin/deno
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 PORT=8000
WORKDIR /app
COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r requirements.txt
COPY app.py /app/app.py
RUN useradd --create-home --uid 10001 mxtube
USER mxtube
EXPOSE 8000
CMD ["sh", "-c", "uvicorn app:app --host 0.0.0.0 --port $PORT --proxy-headers"]

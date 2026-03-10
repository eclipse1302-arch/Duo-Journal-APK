FROM python:3.11-slim

WORKDIR /app

# Copy deployment artifacts
COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r requirements.txt 2>/dev/null || true

COPY dist/ /app/dist/
COPY agentconfig/ /app/agentconfig/
COPY agent.py /app/agent.py
COPY app.py /app/app.py

ENV MODELSCOPE_API_KEY=""

EXPOSE 7860

CMD ["python", "app.py"]

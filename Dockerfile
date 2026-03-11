FROM python:3.11-slim

WORKDIR /app

# Copy deployment artifacts
COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r requirements.txt 2>/dev/null || true

COPY dist/ /app/dist/
COPY agentconfig/ /app/agentconfig/
COPY agent.py /app/agent.py
COPY app.py /app/app.py

# Leave unset so agent.py uses its built-in default key.
# Override at runtime: docker run -e MODELSCOPE_API_KEY=your-key ...
# ENV MODELSCOPE_API_KEY=""

EXPOSE 7860

CMD ["python", "app.py"]

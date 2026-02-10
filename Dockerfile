FROM python:3.11-slim

WORKDIR /app

COPY dist/ /app/dist/
COPY app.py /app/app.py

EXPOSE 7860

CMD ["python", "app.py"]

<<<<<<< HEAD
FROM python:3.11-slim
RUN apt-get update && apt-get install -y nodejs npm
WORKDIR /app

COPY dist/ /app/dist/
COPY app.py /app/app.py

EXPOSE 7860

CMD ["python", "app.py"]
=======
FROM python:3.11-slim

WORKDIR /app

COPY dist/ /app/dist/
COPY app.py /app/app.py

EXPOSE 7860

CMD ["python", "app.py"]
>>>>>>> c643a39e9007293e7db39d36736508b0a8cec35a

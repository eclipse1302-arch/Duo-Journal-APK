import http.server
import socketserver
import os
import threading

PORT = 7860
DIST_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "dist")


class SPAHandler(http.server.SimpleHTTPRequestHandler):
    """Serves the built React SPA with fallback to index.html for client-side routing."""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIST_DIR, **kwargs)

    def do_GET(self):
        # Check if the requested file exists
        path = self.translate_path(self.path)
        if not os.path.exists(path) or (os.path.isdir(path) and not os.path.exists(os.path.join(path, "index.html"))):
            # SPA fallback: serve index.html for all unknown routes
            self.path = "/index.html"
        return super().do_GET()

    def log_message(self, format, *args):
        # Suppress access logs to keep output clean
        pass


def main():
    print(f"Duo Journal - Serving from {DIST_DIR}")
    print(f"Starting server on port {PORT}...")

    with socketserver.TCPServer(("0.0.0.0", PORT), SPAHandler) as httpd:
        print(f"Server running at http://0.0.0.0:{PORT}")
        httpd.serve_forever()


if __name__ == "__main__":
    main()

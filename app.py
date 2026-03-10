import http.server
import socketserver
import os
import json
import urllib.request
import urllib.error

from agent import DiaryCompanionAgent

PORT = 7860
DIST_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "dist")
CONFIG_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "agentconfig")

# Initialise the Diary Companion agent once at startup
agent = DiaryCompanionAgent(config_dir=CONFIG_DIR)


class SPAHandler(http.server.SimpleHTTPRequestHandler):
    """Serves the built React SPA with fallback to index.html for client-side routing.
    Also exposes /api/agent/* endpoints backed by the Diary Companion agent."""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIST_DIR, **kwargs)

    def do_GET(self):
        # Reload agent config on GET /api/agent/reload (for hot-reload during dev)
        if self.path == "/api/agent/reload":
            agent.reload_config()
            self._send_json(200, {"status": "ok", "message": "Agent config reloaded"})
            return

        path = self.translate_path(self.path)
        if not os.path.exists(path) or (
            os.path.isdir(path)
            and not os.path.exists(os.path.join(path, "index.html"))
        ):
            self.path = "/index.html"
        return super().do_GET()

    def do_POST(self):
        if self.path == "/api/agent/comment":
            self._handle_agent_comment()
        elif self.path == "/api/agent/score":
            self._handle_agent_score()
        elif self.path == "/api/agent/chat":
            self._handle_agent_chat()
        elif self.path.startswith("/api/ai/"):
            self._proxy_ai_request()
        else:
            self.send_error(404, "Not Found")

    # ── Agent endpoints ─────────────────────────────────────

    def _read_body(self) -> dict:
        length = int(self.headers.get("Content-Length", 0))
        raw = self.rfile.read(length)
        return json.loads(raw) if raw else {}

    def _send_json(self, status: int, data: dict) -> None:
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _handle_agent_comment(self) -> None:
        try:
            body = self._read_body()
            content = body.get("content", "")
            style = body.get("style", "Neutral")
            if not content.strip():
                self._send_json(400, {"error": "content is required"})
                return
            result = agent.generate_comment(content, style=style)
            self._send_json(200, result)
        except Exception as e:
            self._send_json(500, {"error": str(e)})

    def _handle_agent_score(self) -> None:
        try:
            body = self._read_body()
            content = body.get("content", "")
            style = body.get("style", "Neutral")
            if not content.strip():
                self._send_json(400, {"error": "content is required"})
                return
            result = agent.generate_comment_with_score(content, style=style)
            self._send_json(200, result)
        except Exception as e:
            self._send_json(500, {"error": str(e)})

    def _handle_agent_chat(self) -> None:
        try:
            body = self._read_body()
            content = body.get("content", "")
            history = body.get("history", [])
            message = body.get("message", "")
            style = body.get("style", "Neutral")
            if not content.strip() or not message.strip():
                self._send_json(400, {"error": "content and message are required"})
                return
            result = agent.continue_conversation(content, history, message, style=style)
            self._send_json(200, result)
        except Exception as e:
            self._send_json(500, {"error": str(e)})

    # ── Raw AI proxy (legacy / fallback) ────────────────────

    def _proxy_ai_request(self):
        """Proxy /api/ai/* to ModelScope API /v1/*."""
        target_path = self.path.replace("/api/ai", "/v1", 1)
        target_url = f"https://api-inference.modelscope.cn{target_path}"

        content_length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(content_length)

        headers = {
            "Content-Type": self.headers.get("Content-Type", "application/json"),
        }
        auth = self.headers.get("Authorization")
        if auth:
            headers["Authorization"] = auth

        req = urllib.request.Request(
            target_url, data=body, headers=headers, method="POST"
        )

        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                resp_body = resp.read()
                self.send_response(resp.status)
                self.send_header(
                    "Content-Type",
                    resp.headers.get("Content-Type", "application/json"),
                )
                self.send_header("Content-Length", str(len(resp_body)))
                self.end_headers()
                self.wfile.write(resp_body)
        except urllib.error.HTTPError as e:
            resp_body = e.read()
            self.send_response(e.code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(resp_body)))
            self.end_headers()
            self.wfile.write(resp_body)
        except Exception as e:
            error_msg = json.dumps({"error": str(e)}).encode()
            self.send_response(502)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(error_msg)))
            self.end_headers()
            self.wfile.write(error_msg)

    def log_message(self, format, *args):
        pass


def main():
    print(f"Duo Journal - Serving from {DIST_DIR}")
    print(f"Agent config loaded from {CONFIG_DIR}")
    print(f"Starting server on port {PORT}...")

    with socketserver.ThreadingTCPServer(("0.0.0.0", PORT), SPAHandler) as httpd:
        print(f"Server running at http://0.0.0.0:{PORT}")
        httpd.serve_forever()


if __name__ == "__main__":
    main()

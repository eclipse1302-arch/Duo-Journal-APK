import os
import sys
from http.server import HTTPServer, SimpleHTTPRequestHandler

# 配置端口和文件夹
PORT = 7860
# 获取当前脚本所在目录的绝对路径，并拼接 dist 目录
PROJECT_DIR = os.path.dirname(os.path.abspath(__file__))
WEB_DIR = os.path.join(PROJECT_DIR, 'dist')

class SPAHandler(SimpleHTTPRequestHandler):
    """
    自定义处理器：支持单页应用 (SPA)
    如果找不到对应的文件，默认返回 index.html，防止刷新页面 404
    """
    def __init__(self, *args, **kwargs):
        # 指定静态文件目录为 dist
        super().__init__(*args, directory=WEB_DIR, **kwargs)

    def do_GET(self):
        # 获取请求的文件路径
        # self.path 比如是 "/about" -> 也就是 dist/about
        # 我们需要判断这个路径是否存在
        
        # 简单处理：如果是 /assets 开头或者文件存在，就正常返回
        # 否则返回 index.html (SPA 的路由逻辑)
        path = self.path.split('?')[0] # 去掉查询参数
        
        # 检查是否请求的是根目录
        if path == '/':
            super().do_GET()
            return

        # 构造文件的绝对路径进行检查
        abs_path = os.path.join(WEB_DIR, path.lstrip('/'))
        
        if os.path.exists(abs_path):
            # 文件存在，正常服务
            super().do_GET()
        else:
            # 文件不存在（比如前端路由 /login），返回 index.html
            self.path = '/index.html'
            super().do_GET()

def main():
    print("=" * 40)
    print("   Duo Journal - Starting Static Server")
    print("=" * 40)

    # 1. 检查 dist 目录是否存在
    if not os.path.exists(WEB_DIR):
        print(f"Error: Dist directory not found: {WEB_DIR}")
        print("请确保你已经构建了前端项目，并且 'dist' 文件夹已上传。")
        sys.exit(1)
    
    print(f"Working directory set to: {WEB_DIR}")
    print(f"Starting HTTP server on port {PORT}...")

    # 2. 启动 HTTP 服务器
    try:
        # 绑定到 0.0.0.0 以便外部访问
        server_address = ('0.0.0.0', PORT)
        httpd = HTTPServer(server_address, SPAHandler)
        
        print("\n" + "=" * 40)
        print("   Server is running!")
        print(f"   Local:  http://localhost:{PORT}")
        print("=" * 40)
        print("\nPress Ctrl+C to STOP the server...")
        
        httpd.serve_forever()
        
    except KeyboardInterrupt:
        print("\nShutting down...")
        httpd.socket.close()

if __name__ == "__main__":
    main()
=======
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
>>>>>>> c643a39e9007293e7db39d36736508b0a8cec35a

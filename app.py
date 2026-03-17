import http.server
import socketserver
import os
import json
import urllib.request
import urllib.error
import re
import uuid
import http.cookiejar
import urllib.parse
import ssl
import base64
import traceback
from cryptography.hazmat.primitives.asymmetric import padding as asym_padding
from cryptography.hazmat.primitives import serialization

from agent import DiaryCompanionAgent

PORT = 7860
DIST_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "dist")
CONFIG_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "agentconfig")

SUPABASE_REMOTE_URL = "https://nxjhygndibrmapwofvcs.supabase.co"

# Initialise the Diary Companion agent once at startup
agent = DiaryCompanionAgent(config_dir=CONFIG_DIR)

# In-memory store for CAS sessions (session_id -> { cookie_jar, form_fields })
_cas_sessions: dict = {}

# SSL context that skips certificate verification (some university CAS servers
# use self-signed or misconfigured certificates)
_ssl_ctx = ssl.create_default_context()
_ssl_ctx.check_hostname = False
_ssl_ctx.verify_mode = ssl.CERT_NONE


# ── Timetable scraping helpers ───────────────────────────────

CAS_LOGIN_URL = "https://auth2.shsmu.edu.cn/cas/login"
CAS_BASE_URL = "https://auth2.shsmu.edu.cn/cas/"
CAS_SERVICE = "https://jwstu.shsmu.edu.cn/Login/authLogin"
TIMETABLE_API = "https://jwstu.shsmu.edu.cn/Home/GetCurriculumTable"

# Vision model for captcha solving
VISION_API_URL = "https://api-inference.modelscope.cn/v1/chat/completions"
VISION_MODEL_ID = "Qwen/Qwen2.5-VL-72B-Instruct"


def _rsa_encrypt(plaintext: str, pub_key_b64: str) -> str:
    """Encrypt plaintext using RSA public key (base64-encoded DER/PEM).

    The CAS login page embeds the RSA public key as a base64 string (the
    body of a PEM public key without header/footer lines).  JSEncrypt on
    the browser side uses this to encrypt the password before submission.
    We replicate the same operation here so the server can verify it.
    """
    # Wrap the raw base64 key in PEM armour
    pem_lines = ["-----BEGIN PUBLIC KEY-----"]
    # Split into 64-char lines
    for i in range(0, len(pub_key_b64), 64):
        pem_lines.append(pub_key_b64[i:i + 64])
    pem_lines.append("-----END PUBLIC KEY-----")
    pem_bytes = "\n".join(pem_lines).encode("utf-8")

    public_key = serialization.load_pem_public_key(pem_bytes)
    encrypted = public_key.encrypt(
        plaintext.encode("utf-8"),
        asym_padding.PKCS1v15(),
    )
    return base64.b64encode(encrypted).decode("ascii")


def _build_opener(cookie_jar=None):
    """Build a urllib opener that stores cookies and follows redirects."""
    if cookie_jar is None:
        cookie_jar = http.cookiejar.CookieJar()
    cookie_handler = urllib.request.HTTPCookieProcessor(cookie_jar)
    https_handler = urllib.request.HTTPSHandler(context=_ssl_ctx)
    opener = urllib.request.build_opener(cookie_handler, https_handler)
    opener.addheaders = [
        ("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"),
        ("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"),
        ("Accept-Language", "zh-CN,zh;q=0.9,en;q=0.8"),
    ]
    return opener, cookie_jar


def _fetch_cas_login_page(opener):
    """GET the CAS login page and extract form fields + captcha info."""
    url = f"{CAS_LOGIN_URL}?service={urllib.parse.quote(CAS_SERVICE, safe='')}"
    print(f"[cas] Fetching login page: {url}")
    resp = opener.open(url, timeout=15)
    raw = resp.read()
    # Try UTF-8 first, fall back to GBK (some CAS servers claim UTF-8 but serve GBK)
    try:
        html = raw.decode("utf-8")
    except UnicodeDecodeError:
        html = raw.decode("gbk", errors="replace")
    print(f"[cas] Login page loaded, length={len(html)}, final_url={resp.url}")

    # Extract the form action URL (CAS uses id="fm1" typically)
    form_action_m = re.search(r'<form[^>]*id=["\']fm1["\'][^>]*action=["\']([^"\']+)["\']', html, re.I)
    if not form_action_m:
        form_action_m = re.search(r'<form[^>]*action=["\']([^"\']*(?:login|Login)[^"\']*)["\'][^>]*id=["\']fm1["\']', html, re.I)
    if not form_action_m:
        form_action_m = re.search(r'<form[^>]*action=["\']([^"\']*(?:login|Login)[^"\']*)["\']', html, re.I)
    form_action = form_action_m.group(1) if form_action_m else None
    print(f"[cas] Form action URL: {form_action}")

    # Detect username/password field names from the form
    username_field_m = re.search(r'<input[^>]+name=["\']([^"\']*(?:user|name|account|login)[^"\']*)["\'][^>]*type=["\']text["\']', html, re.I)
    if not username_field_m:
        username_field_m = re.search(r'<input[^>]+type=["\']text["\'][^>]*name=["\']([^"\']*(?:user|name|account|login)[^"\']*)["\']', html, re.I)
    password_field_m = re.search(r'<input[^>]+name=["\']([^"\']*(?:pass|pwd|password)[^"\']*)["\']', html, re.I)
    if not password_field_m:
        password_field_m = re.search(r'<input[^>]+type=["\']password["\'][^>]*name=["\']([^"\']+)["\']', html, re.I)
    print(f"[cas] Username field: {username_field_m.group(1) if username_field_m else 'username (default)'}")
    print(f"[cas] Password field: {password_field_m.group(1) if password_field_m else 'password (default)'}")

    # Extract ALL form fields (hidden + visible input/select names)
    fields = {}
    for m in re.finditer(r'<input[^>]+type=["\']hidden["\'][^>]*>', html, re.I):
        tag = m.group(0)
        name_m = re.search(r'name=["\']([^"\']+)["\']', tag)
        value_m = re.search(r'value=["\']([^"\']*)["\']', tag)
        if name_m:
            fields[name_m.group(1)] = value_m.group(1) if value_m else ""

    # Store form_action and detected field names for use in _do_cas_login
    if form_action:
        fields["__form_action__"] = form_action
    if username_field_m:
        fields["__username_field__"] = username_field_m.group(1)
    if password_field_m:
        fields["__password_field__"] = password_field_m.group(1)

    # Extract RSA public key for password encryption
    # CAS pages using jsencrypt.js embed the key as: var login_Key = "MIGf...";
    rsa_key_m = re.search(r'var\s+login_Key\s*=\s*["\']([A-Za-z0-9+/=]+)["\']', html)
    if rsa_key_m:
        fields["__rsa_public_key__"] = rsa_key_m.group(1)
        print(f"[cas] RSA public key found (length={len(rsa_key_m.group(1))})")
    else:
        print("[cas] No RSA public key found - password will be sent in plain text")

    # Detect the captcha input field name from the form
    captcha_field_name = None
    # Look for input near "captcha" or "验证码" label
    captcha_input_m = re.search(
        r'<input[^>]+name=["\']([^"\']+)["\'][^>]*(?:captcha|验证|validate|authcode)',
        html, re.I
    )
    if not captcha_input_m:
        # Try reverse: attribute order might differ
        captcha_input_m = re.search(
            r'(?:captcha|验证|validate|authcode)[^<]*<input[^>]+name=["\']([^"\']+)["\']',
            html, re.I
        )
    if not captcha_input_m:
        # Look for any input with captcha-like name
        captcha_input_m = re.search(
            r'<input[^>]+name=["\']([^"\']*(?:captcha|validate|authcode|code|verify)[^"\']*)["\']',
            html, re.I
        )
    if not captcha_input_m:
        # Last resort: look for any text input that is NOT username/password
        all_text_inputs = re.findall(r'<input[^>]+(?:type=["\']text["\'])?[^>]+name=["\']([^"\']+)["\']', html, re.I)
        known_fields = {"username", "password", "user", "name", "lt", "execution", "_eventId", "submit"}
        known_fields.update(fields.keys())
        for inp_name in all_text_inputs:
            if inp_name.lower() not in known_fields and inp_name not in fields:
                captcha_field_name = inp_name
                print(f"[cas] Captcha field (heuristic from text inputs): {captcha_field_name}")
                break
    if captcha_input_m and not captcha_field_name:
        captcha_field_name = captcha_input_m.group(1)

    print(f"[cas] Form fields found: {list(fields.keys())}")
    print(f"[cas] Captcha field name detected: {captcha_field_name}")

    # Check for captcha image
    captcha_url = None
    captcha_m = re.search(r'<img[^>]+src=["\']([^"\']*captcha[^"\']*)["\']', html, re.I)
    if not captcha_m:
        captcha_m = re.search(r'<img[^>]+id=["\'][^"\']*captcha[^"\']*["\'][^>]+src=["\']([^"\']*)["\']', html, re.I)
    if not captcha_m:
        # Check for any img near captcha/验证码 text
        captcha_m = re.search(r'(?:captcha|验证)[^<]*<img[^>]+src=["\']([^"\']+)["\']', html, re.I)
    if captcha_m:
        captcha_url = captcha_m.group(1)
        # Handle all URL forms: absolute, root-relative, and relative
        if captcha_url.startswith("http"):
            pass  # Already absolute
        elif captcha_url.startswith("/"):
            captcha_url = f"https://auth2.shsmu.edu.cn{captcha_url}"
        else:
            # Relative URL like "captcha.jpg" - resolve against CAS base
            captcha_url = f"{CAS_BASE_URL}{captcha_url}"

    print(f"[cas] Captcha URL: {captcha_url}")

    # Print HTML snippet around captcha for debugging
    if captcha_url:
        cap_idx = html.lower().find("captcha")
        if cap_idx >= 0:
            snippet_start = max(0, cap_idx - 200)
            snippet_end = min(len(html), cap_idx + 500)
            print(f"[cas] HTML around captcha:\n{html[snippet_start:snippet_end]}")

    return fields, captcha_url, html, captcha_field_name


def _fetch_captcha_image(opener, captcha_url):
    """Download the captcha image and return (base64_data_url, raw_bytes)."""
    resp = opener.open(captcha_url, timeout=10)
    img_bytes = resp.read()
    content_type = resp.headers.get("Content-Type", "image/jpeg")
    b64 = base64.b64encode(img_bytes).decode("ascii")
    return f"data:{content_type};base64,{b64}", img_bytes


def _solve_math_captcha(img_bytes):
    """Try to auto-solve a simple math captcha (e.g. '3+4=?') using a vision LLM.

    Returns the answer string if successful, or None if it cannot be solved.
    """
    from agent import MODELSCOPE_API_KEY

    b64_img = base64.b64encode(img_bytes).decode("ascii")

    payload = {
        "model": VISION_MODEL_ID,
        "messages": [
            {
                "role": "user",
                "content": [
                    {
                        "type": "image_url",
                        "image_url": {"url": f"data:image/jpeg;base64,{b64_img}"},
                    },
                    {
                        "type": "text",
                        "text": (
                            "This is a captcha image showing a simple math problem like 'X+Y=?'. "
                            "Please identify the two numbers and the operator, compute the result, "
                            "and respond with ONLY the numeric answer. Nothing else."
                        ),
                    },
                ],
            }
        ],
        "max_tokens": 16,
        "temperature": 0,
    }

    body = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        VISION_API_URL,
        data=body,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {MODELSCOPE_API_KEY}",
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            answer_text = data["choices"][0]["message"]["content"].strip()
            # Extract just the number from the response
            num_m = re.search(r'\d+', answer_text)
            if num_m:
                return num_m.group(0)
    except Exception as e:
        print(f"[captcha-solver] Vision API failed: {e}")

    return None


def _do_cas_login(opener, fields, username, password, captcha_code=None, captcha_field=None):
    """POST credentials to CAS and follow redirects to get authenticated session."""
    # Use detected field names if available, otherwise fall back to defaults
    username_key = fields.pop("__username_field__", None) or "username"
    password_key = fields.pop("__password_field__", None) or "password"
    form_action = fields.pop("__form_action__", None)
    rsa_public_key = fields.pop("__rsa_public_key__", None)

    # Fallback: if login_Key regex didn't find the key, use the sessionKey hidden
    # field value — this is what the browser's enkey() function actually uses.
    if not rsa_public_key:
        session_key_val = fields.get("sessionKey", "")
        if session_key_val and len(session_key_val) > 50:
            rsa_public_key = session_key_val
            print("[cas-login] Using sessionKey hidden field for RSA encryption (login_Key not found in HTML)")

    # Encrypt password with RSA if the CAS page provided a public key
    actual_password = password
    if rsa_public_key:
        try:
            actual_password = _rsa_encrypt(password, rsa_public_key)
            print(f"[cas-login] Password encrypted with RSA (length={len(actual_password)})")
        except Exception as e:
            print(f"[cas-login] RSA encryption failed, using plain password: {e}")
            actual_password = password

    post_data = {
        username_key: username,
        password_key: actual_password,
        "_eventId": "submit",
    }
    # Merge hidden form fields (skip internal __ keys)
    for k, v in fields.items():
        if k not in post_data and not k.startswith("__"):
            post_data[k] = v

    # The browser JS sets sessionKey to the RSA public key before submission.
    # We must replicate this so the CAS server can match the key used for encryption.
    # Always set it when RSA is available (the browser always does this).
    if rsa_public_key:
        post_data["sessionKey"] = rsa_public_key

    if captcha_code:
        if captcha_field:
            # Use the detected field name
            post_data[captcha_field] = captcha_code
        else:
            # Shotgun approach: add all common captcha field names
            for field_name in ["captchaResponse", "captcha", "validateCode", "authcode", "code", "captcha_code"]:
                post_data[field_name] = captcha_code

    # Determine POST URL - use form_action if detected
    if form_action:
        if form_action.startswith("http"):
            post_url = form_action
        elif form_action.startswith("/"):
            post_url = f"https://auth2.shsmu.edu.cn{form_action}"
        else:
            post_url = f"{CAS_BASE_URL}{form_action}"
        # Ensure service param is included
        if "service=" not in post_url:
            sep = "&" if "?" in post_url else "?"
            post_url = f"{post_url}{sep}service={urllib.parse.quote(CAS_SERVICE, safe='')}"
    else:
        post_url = f"{CAS_LOGIN_URL}?service={urllib.parse.quote(CAS_SERVICE, safe='')}"

    body = urllib.parse.urlencode(post_data).encode("utf-8")

    print(f"[cas-login] POST URL: {post_url}")
    print(f"[cas-login] POST fields: {list(post_data.keys())}")
    print(f"[cas-login] Username key={username_key}, Password key={password_key}")
    print(f"[cas-login] Captcha code: {captcha_code}, field: {captcha_field}")
    print(f"[cas-login] RSA encryption used: {rsa_public_key is not None}")

    # Build the request with browser-like headers
    req = urllib.request.Request(post_url, data=body, method="POST")
    req.add_header("Content-Type", "application/x-www-form-urlencoded")
    # Referer should be the login page URL (not the form action URL with jsessionid)
    referer_url = f"{CAS_LOGIN_URL}?service={urllib.parse.quote(CAS_SERVICE, safe='')}"
    req.add_header("Referer", referer_url)
    req.add_header("Origin", "https://auth2.shsmu.edu.cn")

    try:
        resp = opener.open(req, timeout=15)
    except urllib.error.HTTPError as e:
        print(f"[cas-login] HTTPError {e.code}: {e.url}")
        if e.code in (301, 302, 303) and e.headers.get("Location"):
            location = e.headers["Location"]
            print(f"[cas-login] Redirect to: {location}")
            try:
                resp = opener.open(location, timeout=15)
            except urllib.error.HTTPError as e2:
                print(f"[cas-login] Redirect HTTPError {e2.code}: {e2.url}")
                return False, f"CAS redirect error HTTP {e2.code}"
        else:
            err_body = ""
            try:
                err_body = e.read().decode("utf-8", errors="replace")[:500]
            except Exception:
                pass
            print(f"[cas-login] HTTP {e.code} body: {err_body}")
            return False, f"CAS returned HTTP {e.code}"
    except Exception as e:
        print(f"[cas-login] Exception during POST: {type(e).__name__}: {e}")
        return False, f"Connection error: {str(e)}"

    raw_result = resp.read()
    try:
        result_html = raw_result.decode("utf-8")
    except UnicodeDecodeError:
        result_html = raw_result.decode("gbk", errors="replace")
    final_url = resp.url

    print(f"[cas-login] Final URL: {final_url}")
    print(f"[cas-login] Response length: {len(result_html)}")

    # Check if login succeeded (redirected away from CAS login page)
    if "cas/login" in final_url.lower() and "ticket" not in final_url.lower():
        # The URL still shows CAS login page. But check if the response body
        # contains a redirect (some CAS versions use JS-based redirect).
        ticket_m = re.search(r'ticket=(ST-[A-Za-z0-9-]+)', result_html)
        js_redirect_m = re.search(
            r'(?:window\.location(?:\.href)?\s*=|location\.replace\()\s*["\']([^"\']+)["\']',
            result_html,
        )
        meta_redirect_m = re.search(
            r'<meta[^>]+http-equiv=["\']refresh["\'][^>]+url=([^"\'>\s]+)',
            result_html, re.I,
        )
        if ticket_m or js_redirect_m or meta_redirect_m:
            redirect_url = None
            if js_redirect_m:
                redirect_url = js_redirect_m.group(1)
            elif meta_redirect_m:
                redirect_url = meta_redirect_m.group(1)
            elif ticket_m:
                redirect_url = f"{CAS_SERVICE}?ticket={ticket_m.group(1)}"
            if redirect_url:
                print(f"[cas-login] Found redirect in response body: {redirect_url}")
                try:
                    resp2 = opener.open(redirect_url, timeout=15)
                    final_url = resp2.url
                    print(f"[cas-login] Followed redirect to: {final_url}")
                    return True, final_url
                except Exception as redir_e:
                    print(f"[cas-login] Failed to follow redirect: {redir_e}")

        # Still on login page - extract error message
        # SHSMU CAS uses: <div id="errormsghide">error text</div>
        # The error text may be inside nested tags like <span>.
        err_msg = ""
        for pat in [
            r'<div[^>]*id=["\']errormsghide["\'][^>]*>(.*?)</div>',
            r'<div[^>]*id=["\']msg["\'][^>]*class=["\'][^"\']*errors?[^"\']*["\'][^>]*>(.*?)</div>',
            r'<span[^>]*id=["\']errormsg["\'][^>]*>(.*?)</span>',
            r'class=["\'][^"\']*errors?[^"\']*["\'][^>]*>([^<]+)',
            r'<span[^>]*class=["\'][^"\']*(?:error|alert)[^"\']*["\'][^>]*>([^<]+)',
        ]:
            m = re.search(pat, result_html, re.I | re.DOTALL)
            if m:
                # Strip HTML tags to get plain text
                text = re.sub(r'<[^>]+>', '', m.group(1)).strip()
                # Skip the generic HTTPS warning (not a login error)
                if text and "non-secure" not in text.lower() and "single sign on" not in text.lower():
                    err_msg = text
                    print(f"[cas-login] Error matched by pattern: {pat[:50]}...")
                    break

        if not err_msg:
            # Log a snippet of the response for debugging
            body_snippet = result_html[:800] if len(result_html) > 800 else result_html
            print(f"[cas-login] No error message extracted. Response snippet:\n{body_snippet}")
            err_msg = "Login failed. Check credentials or captcha."
        print(f"[cas-login] Login FAILED: {err_msg}")
        return False, err_msg

    print(f"[cas-login] Login succeeded, redirected to: {final_url}")
    return True, final_url


def _fetch_timetable(opener):
    """Fetch timetable via the GetCurriculumTable JSON API for the entire semester.

    SJTU Medical courses vary week-to-week, so we fetch the full semester
    and store each course with its specific date (not just day_of_week).
    Spring semester: ~Feb 17 – Jul 13
    Fall semester:   ~Sep 1  – Jan 18 (next year)
    """
    from datetime import date, timedelta

    today = date.today()
    month = today.month

    # Determine semester boundaries (generous to avoid missing courses)
    if 2 <= month <= 8:
        # Spring semester
        semester_start = date(today.year, 2, 10)
        semester_end = date(today.year, 7, 20)
    else:
        # Fall semester
        if month >= 9:
            semester_start = date(today.year, 8, 25)
            semester_end = date(today.year + 1, 1, 25)
        else:
            # Jan
            semester_start = date(today.year - 1, 8, 25)
            semester_end = date(today.year, 1, 25)

    url = f"{TIMETABLE_API}?Start={semester_start.isoformat()}&End={semester_end.isoformat()}"
    print(f"[timetable] Fetching full semester: {semester_start} to {semester_end}")
    print(f"[timetable] URL: {url}")

    resp = opener.open(url, timeout=30)
    raw = resp.read()
    final_url = resp.url

    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError:
        text = raw.decode("gbk", errors="replace")

    print(f"[timetable] Response length={len(text)}, url={final_url}")

    # If redirected back to login, auth failed
    if "login" in final_url.lower() or "cas" in final_url.lower():
        print("[timetable] WARNING: Redirected to login page")
        return {"error": "Session expired or auth failed - redirected to login page"}

    try:
        data = json.loads(text)
    except json.JSONDecodeError as e:
        print(f"[timetable] JSON parse error: {e}")
        print(f"[timetable] Response snippet: {text[:500]}")
        return {"error": f"Invalid JSON response from timetable API: {e}"}

    course_list = data.get("List") or []
    print(f"[timetable] Title: {data.get('Title', 'N/A')}")
    print(f"[timetable] Total course entries: {len(course_list)}")

    courses = []
    for item in course_list:
        start_str = item.get("Start", "")   # "2026-03-17T08:00:00"
        end_str = item.get("End", "")       # "2026-03-17T09:30:00"

        # Extract date and time from ISO datetime
        course_date = ""
        start_time = ""
        end_time = ""
        if start_str and "T" in start_str:
            course_date = start_str.split("T")[0]       # "2026-03-17"
            start_time = start_str.split("T")[1][:5]    # "08:00"
        if end_str and "T" in end_str:
            end_time = end_str.split("T")[1][:5]        # "09:30"

        course = {
            "course_date": course_date,
            "start_time": start_time,
            "end_time": end_time,
            "course_name": item.get("Curriculum", "") or "",
            "classroom": item.get("ClassroomAcademy", "") or item.get("Classroom", "") or "",
            "teacher": item.get("Teacher", "") or "",
        }
        if course["course_name"] and course_date:
            courses.append(course)

    print(f"[timetable] Parsed {len(courses)} courses across semester")
    if courses:
        # Show a summary of date range
        dates = sorted(set(c["course_date"] for c in courses))
        print(f"[timetable] Date range: {dates[0]} to {dates[-1]} ({len(dates)} unique days)")

    if not courses:
        return {"error": "No courses found in timetable API response"}

    return courses


class SPAHandler(http.server.SimpleHTTPRequestHandler):
    """Serves the built React SPA with fallback to index.html for client-side routing.
    Also exposes /api/agent/* endpoints backed by the Diary Companion agent."""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIST_DIR, **kwargs)

    def do_GET(self):
        # Supabase proxy
        if self.path.startswith("/supabase-api/"):
            self._proxy_supabase()
            return

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
        if self.path.startswith("/supabase-api/"):
            self._proxy_supabase()
        elif self.path == "/api/agent/comment":
            self._handle_agent_comment()
        elif self.path == "/api/agent/score":
            self._handle_agent_score()
        elif self.path == "/api/agent/chat":
            self._handle_agent_chat()
        elif self.path == "/api/timetable/sync":
            self._handle_timetable_sync()
        elif self.path.startswith("/api/ai/"):
            self._proxy_ai_request()
        else:
            self.send_error(404, "Not Found")

    def do_PATCH(self):
        if self.path.startswith("/supabase-api/"):
            self._proxy_supabase()
        else:
            self.send_error(404, "Not Found")

    def do_PUT(self):
        if self.path.startswith("/supabase-api/"):
            self._proxy_supabase()
        else:
            self.send_error(404, "Not Found")

    def do_DELETE(self):
        if self.path.startswith("/supabase-api/"):
            self._proxy_supabase()
        else:
            self.send_error(404, "Not Found")

    def do_OPTIONS(self):
        if self.path.startswith("/supabase-api/"):
            # CORS preflight for Supabase proxy
            self.send_response(204)
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type, apikey, Authorization, X-Client-Info, Prefer, Accept")
            self.send_header("Access-Control-Max-Age", "86400")
            self.end_headers()
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

    # ── Timetable sync endpoint ────────────────────────────

    def _handle_timetable_sync(self) -> None:
        """Handle timetable sync requests.

        Two-phase flow:
        Phase 1 (no session_id): Fetch CAS login page, return captcha if needed.
        Phase 2 (with session_id + captcha_code): Complete login and scrape.
        One-shot (no captcha): Login and scrape immediately.
        """
        try:
            body = self._read_body()
            username = body.get("username", "").strip()
            password = body.get("password", "").strip()
            session_id = body.get("session_id", "")
            captcha_code = body.get("captcha_code", "")

            if not username or not password:
                self._send_json(400, {"error": "username and password are required"})
                return

            # Phase 2: Resume a session with captcha answer
            if session_id and session_id in _cas_sessions:
                sess = _cas_sessions.pop(session_id)
                opener, _ = _build_opener(sess["cookie_jar"])

                ok, result = _do_cas_login(
                    opener, sess["fields"], username, password, captcha_code,
                    captcha_field=sess.get("captcha_field"),
                )
                if not ok:
                    self._send_json(401, {"error": result})
                    return

                courses = _fetch_timetable(opener)
                if isinstance(courses, dict) and "error" in courses:
                    self._send_json(200, {"courses": [], "warning": courses["error"]})
                else:
                    self._send_json(200, {"courses": courses})
                return

            # Phase 1: Fresh login attempt
            opener, cookie_jar = _build_opener()
            fields, captcha_url, _, captcha_field = _fetch_cas_login_page(opener)

            if captcha_url:
                # Captcha required - fetch image and try to auto-solve
                captcha_b64, captcha_bytes = _fetch_captcha_image(opener, captcha_url)

                # Try auto-solving the math captcha via vision LLM
                print("[captcha-solver] Attempting auto-solve...")
                answer = _solve_math_captcha(captcha_bytes)

                if answer:
                    print(f"[captcha-solver] Auto-solved: {answer}")
                    ok, result = _do_cas_login(
                        opener, fields, username, password, answer,
                        captcha_field=captcha_field,
                    )
                    if ok:
                        courses = _fetch_timetable(opener)
                        if isinstance(courses, dict) and "error" in courses:
                            self._send_json(200, {"courses": [], "warning": courses["error"]})
                        else:
                            self._send_json(200, {"courses": courses})
                        return
                    # Auto-solve answer was wrong; fall through to manual
                    print(f"[captcha-solver] Auto-solve answer rejected: {result}")
                    # Need a fresh captcha for the user since the old one is consumed
                    opener, cookie_jar = _build_opener()
                    fields, captcha_url, _, captcha_field = _fetch_cas_login_page(opener)
                    if captcha_url:
                        captcha_b64, _ = _fetch_captcha_image(opener, captcha_url)

                # Return captcha to frontend for manual entry
                sid = str(uuid.uuid4())
                _cas_sessions[sid] = {"cookie_jar": cookie_jar, "fields": fields, "captcha_field": captcha_field}
                self._send_json(200, {
                    "captcha_required": True,
                    "captcha_image": captcha_b64,
                    "session_id": sid,
                })
                return

            # No captcha - proceed directly
            ok, result = _do_cas_login(opener, fields, username, password)
            if not ok:
                self._send_json(401, {"error": result})
                return

            courses = _fetch_timetable(opener)
            if isinstance(courses, dict) and "error" in courses:
                self._send_json(200, {"courses": [], "warning": courses["error"]})
            else:
                self._send_json(200, {"courses": courses})

        except Exception as e:
            print(f"[timetable-sync] EXCEPTION: {type(e).__name__}: {e}")
            traceback.print_exc()
            self._send_json(500, {"error": f"Timetable sync failed: {type(e).__name__}: {str(e)}"})

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
        print(f"[http] {self.client_address[0]} - {format % args}")

    # ── Supabase reverse proxy ──────────────────────────────

    def _proxy_supabase(self):
        """Proxy /supabase-api/* to Supabase cloud, so the browser never
        makes cross-origin requests (fixes 'url not in domain list' errors
        in restricted environments like WeChat browser)."""
        target_path = self.path.replace("/supabase-api", "", 1)
        target_url = f"{SUPABASE_REMOTE_URL}{target_path}"

        content_length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(content_length) if content_length > 0 else None

        headers = {}
        for key in (
            "Content-Type", "apikey", "Authorization", "Accept",
            "X-Client-Info", "Prefer", "Range",
        ):
            val = self.headers.get(key)
            if val:
                headers[key] = val

        req = urllib.request.Request(
            target_url, data=body, headers=headers, method=self.command,
        )

        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                resp_body = resp.read()
                self.send_response(resp.status)
                for hdr in ("Content-Type", "Content-Range"):
                    val = resp.headers.get(hdr)
                    if val:
                        self.send_header(hdr, val)
                self.send_header("Content-Length", str(len(resp_body)))
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(resp_body)
        except urllib.error.HTTPError as e:
            resp_body = e.read()
            self.send_response(e.code)
            ct = e.headers.get("Content-Type", "application/json")
            self.send_header("Content-Type", ct)
            self.send_header("Content-Length", str(len(resp_body)))
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(resp_body)
        except Exception as e:
            error_msg = json.dumps({"error": str(e)}).encode()
            self.send_response(502)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(error_msg)))
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(error_msg)


def main():
    print(f"Duo Journal - Serving from {DIST_DIR}")
    print(f"Agent config loaded from {CONFIG_DIR}")
    print(f"Starting server on port {PORT}...")

    with socketserver.ThreadingTCPServer(("0.0.0.0", PORT), SPAHandler) as httpd:
        print(f"Server running at http://0.0.0.0:{PORT}")
        httpd.serve_forever()


if __name__ == "__main__":
    main()

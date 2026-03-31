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
import datetime
from cryptography.hazmat.primitives.asymmetric import padding as asym_padding
from cryptography.hazmat.primitives import serialization

APP_VERSION = "2026-03-31-v20"  # Version marker to verify deployment

try:
    from agent import DiaryCompanionAgent
except Exception as _agent_import_err:
    DiaryCompanionAgent = None
    _AGENT_IMPORT_ERROR = _agent_import_err
else:
    _AGENT_IMPORT_ERROR = None

PORT = int(os.environ.get("PORT", "7860"))
DIST_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "dist")
CONFIG_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "agentconfig")
RUNTIME_TUNNEL_STATE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "runtime_tunnel_state.json")
REGISTER_TOKEN = os.environ.get("TUNNEL_REGISTER_TOKEN", "").strip()

SUPABASE_REMOTE_URL = "https://nxjhygndibrmapwofvcs.supabase.co"

# Lazy-init agent to avoid blocking timetable backend startup.
agent = None


def _get_agent():
    global agent
    if agent is not None:
        return agent
    if DiaryCompanionAgent is None:
        raise RuntimeError(f"Agent import failed: {_AGENT_IMPORT_ERROR}")
    agent = DiaryCompanionAgent(config_dir=CONFIG_DIR)
    return agent

# In-memory store for CAS sessions (session_id -> { cookie_jar, form_fields })
_cas_sessions: dict = {}
_runtime_tunnel_url = None
_runtime_tunnel_updated_at = None


def _load_runtime_tunnel_state():
    global _runtime_tunnel_url, _runtime_tunnel_updated_at
    try:
        if not os.path.exists(RUNTIME_TUNNEL_STATE):
            return
        with open(RUNTIME_TUNNEL_STATE, "r", encoding="utf-8") as f:
            data = json.load(f)
        url = str(data.get("url", "")).strip()
        if url.startswith("http://") or url.startswith("https://"):
            _runtime_tunnel_url = url.rstrip("/")
            _runtime_tunnel_updated_at = data.get("updated_at")
    except Exception as e:
        print(f"[runtime-tunnel] load failed: {e}")


def _save_runtime_tunnel_state(url: str):
    global _runtime_tunnel_url, _runtime_tunnel_updated_at
    _runtime_tunnel_url = url.rstrip("/")
    _runtime_tunnel_updated_at = datetime.datetime.utcnow().isoformat() + "Z"
    payload = {"url": _runtime_tunnel_url, "updated_at": _runtime_tunnel_updated_at}
    try:
        with open(RUNTIME_TUNNEL_STATE, "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False)
    except Exception as e:
        print(f"[runtime-tunnel] save failed: {e}")

# SSL context that skips certificate verification (some university CAS servers
# use self-signed or misconfigured certificates)
_ssl_ctx = ssl.create_default_context()
_ssl_ctx.check_hostname = False
_ssl_ctx.verify_mode = ssl.CERT_NONE


# ── Timetable scraping helpers ───────────────────────────────

CAS_LOGIN_URL = "https://auth2.shsmu.edu.cn/cas/login"
CAS_BASE_URL = "https://auth2.shsmu.edu.cn/cas/"
CAS_CAPTCHA_URL = "https://auth2.shsmu.edu.cn/cas/captcha.jpg"
CAS_SERVICE = "https://jwstu.shsmu.edu.cn/Login/authLogin"
TIMETABLE_API = "https://jwstu.shsmu.edu.cn/Home/GetCurriculumTable"


def _extract_visible_text(html: str, max_len: int = 260) -> str:
    """Extract a compact visible-text summary from HTML for diagnostics."""
    if not html:
        return ""
    try:
        text = re.sub(r"<script[\s\S]*?</script>", " ", html, flags=re.I)
        text = re.sub(r"<style[\s\S]*?</style>", " ", text, flags=re.I)
        text = re.sub(r"<[^>]+>", " ", text)
        text = re.sub(r"\s+", " ", text).strip()
        return text[:max_len]
    except Exception:
        return ""


def _rsa_encrypt(plaintext: str, pub_key_b64: str) -> str:
    """Encrypt plaintext using RSA public key (base64-encoded DER/PEM).

    The CAS login page embeds the RSA public key as a base64 string (the
    body of a PEM public key without header/footer lines).  JSEncrypt on
    the browser side uses this to encrypt the password before submission.
    We replicate the same operation here so the server can verify it.
    """
    # The CAS RSA key is often provided as base64 of the DER body (as used by
    # browser enkey/JSEncrypt). Be tolerant to both DER and PEM-body formats.
    pub_key_der = None
    try:
        pub_key_der = base64.b64decode(pub_key_b64)
    except Exception:
        pub_key_der = None

    public_key = None
    if pub_key_der:
        try:
            public_key = serialization.load_der_public_key(pub_key_der)
        except Exception:
            public_key = None

    if public_key is None:
        # Fall back to PEM armour: assume pub_key_b64 contains only the PEM body.
        # Try both PUBLIC KEY and RSA PUBLIC KEY headers.
        def _try_pem(header: str):
            pem_lines = [f"-----BEGIN {header}-----"]
            for i in range(0, len(pub_key_b64), 64):
                pem_lines.append(pub_key_b64[i:i + 64])
            pem_lines.append(f"-----END {header}-----")
            pem_bytes = "\n".join(pem_lines).encode("utf-8")
            return serialization.load_pem_public_key(pem_bytes)

        try:
            public_key = _try_pem("PUBLIC KEY")
        except Exception:
            public_key = _try_pem("RSA PUBLIC KEY")

    encrypted = public_key.encrypt(
        plaintext.encode("utf-8"),
        asym_padding.PKCS1v15(),
    )
    return base64.b64encode(encrypted).decode("ascii")


def _build_opener(cookie_jar=None):
    """Build a urllib opener that stores cookies and follows redirects."""
    if cookie_jar is None:
        cookie_jar = http.cookiejar.CookieJar()
    # Force direct connection and ignore system proxy env vars.
    # Some hosting environments inject proxy settings that rewrite CAS traffic
    # to webvpn/non-secure pages.
    proxy_handler = urllib.request.ProxyHandler({})
    cookie_handler = urllib.request.HTTPCookieProcessor(cookie_jar)
    https_handler = urllib.request.HTTPSHandler(context=_ssl_ctx)
    opener = urllib.request.build_opener(proxy_handler, cookie_handler, https_handler)
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
    final_url = resp.url
    print(f"[cas] Login page loaded, length={len(html)}, final_url={final_url}")

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

    # Extract RSA public key for password encryption (multiple CAS layouts)
    rsa_key_m = re.search(r'var\s+login_Key\s*=\s*["\']([A-Za-z0-9+/=]+)["\']', html)
    if not rsa_key_m:
        rsa_key_m = re.search(r'["\']login_Key["\']\s*:\s*["\']([A-Za-z0-9+/=]+)["\']', html)
    if not rsa_key_m:
        rsa_key_m = re.search(r'encryptKey\s*[:=]\s*["\']([A-Za-z0-9+/=]+)["\']', html, re.I)
    if not rsa_key_m:
        rsa_key_m = re.search(r'publicKey\s*[:=]\s*["\']([A-Za-z0-9+/=]+)["\']', html, re.I)
    if rsa_key_m:
        fields["__rsa_public_key__"] = rsa_key_m.group(1)
        print(f"[cas] RSA public key found (length={len(rsa_key_m.group(1))})")
    else:
        print("[cas] No RSA public key found - password will be sent in plain text")

    # Detect captcha input field names from the form
    captcha_field_name = None
    captcha_fields = set()
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
    if captcha_field_name:
        captcha_fields.add(captcha_field_name)

    # Collect all input names that look captcha-related
    for m in re.finditer(r'<input[^>]+name=["\']([^"\']+)["\']', html, re.I):
        nm = m.group(1)
        if re.search(r'captcha|authcode|verify|validate|checkcode|rand', nm, re.I):
            captcha_fields.add(nm)
    if captcha_fields:
        fields["__captcha_fields__"] = ",".join(sorted(captcha_fields))

    print(f"[cas] Form fields found: {list(fields.keys())}")
    print(f"[cas] Captcha field name detected: {captcha_field_name}")
    print(f"[cas] Captcha field candidates: {sorted(captcha_fields)}")

    # Check for captcha image
    captcha_url = None
    captcha_m = re.search(r'<img[^>]+src=["\']([^"\']*captcha[^"\']*)["\']', html, re.I)
    if not captcha_m:
        captcha_m = re.search(r'<img[^>]+id=["\'][^"\']*captcha[^"\']*["\'][^>]+src=["\']([^"\']*)["\']', html, re.I)
    if not captcha_m:
        # Check for any img near captcha/验证码 text
        captcha_m = re.search(r'(?:captcha|验证)[^<]*<img[^>]+src=["\']([^"\']+)["\']', html, re.I)
    if not captcha_m:
        # kaptcha / validateCode in filename
        captcha_m = re.search(
            r'<img[^>]+src=["\']([^"\']*(?:kaptcha|captcha|validate|verify|code)[^"\']*)["\']',
            html, re.I,
        )
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

    # Force the known SHSMU CAS captcha endpoint when captcha is required.
    # This avoids brittle HTML img-src parsing differences across CAS layouts.
    if captcha_field_name:
        captcha_url = CAS_CAPTCHA_URL
        print(f"[cas] Using fixed captcha URL: {captcha_url}")
    elif not captcha_url:
        # Conservative fallback when no captcha field is detected but HTML still hints captcha.
        captcha_url = CAS_CAPTCHA_URL
        print(f"[cas] Fallback fixed captcha URL: {captcha_url}")

    print(f"[cas] Captcha URL: {captcha_url}")

    # Print HTML snippet around captcha for debugging
    if captcha_url:
        cap_idx = html.lower().find("captcha")
        if cap_idx >= 0:
            snippet_start = max(0, cap_idx - 200)
            snippet_end = min(len(html), cap_idx + 500)
            print(f"[cas] HTML around captcha:\n{html[snippet_start:snippet_end]}")

    return fields, captcha_url, html, captcha_field_name, final_url


def _fetch_captcha_image(opener, captcha_url):
    """Download captcha image and return (base64_data_url, raw_bytes).

    Per user requirement, always fetch from fixed CAS_CAPTCHA_URL.
    """
    # Add a cache-busting query param so CAS/CDN/proxy won't return a stale image.
    ts = int(uuid.uuid4().int % 10_000_000_000)
    target_url = f"{CAS_CAPTCHA_URL}?_={ts}"
    req = urllib.request.Request(target_url, method="GET")
    req.add_header("Accept", "image/avif,image/webp,image/apng,image/*,*/*;q=0.8")
    req.add_header("Cache-Control", "no-cache")
    req.add_header("Pragma", "no-cache")
    # Referer should be the login page with service param so CAS binds captcha
    # to the correct session.
    referer_url = f"{CAS_LOGIN_URL}?service={urllib.parse.quote(CAS_SERVICE, safe='')}"
    req.add_header("Referer", referer_url)
    req.add_header("Origin", "https://auth2.shsmu.edu.cn")

    resp = opener.open(req, timeout=10)
    img_bytes = resp.read()
    content_type = resp.headers.get("Content-Type", "image/jpeg") or "image/jpeg"

    b64 = base64.b64encode(img_bytes).decode("ascii")
    return f"data:{content_type};base64,{b64}", img_bytes


def _probe_captcha_url(opener, url: str) -> dict:
    """Probe fixed captcha endpoint and return minimal diagnostics."""
    ts = int(uuid.uuid4().int % 10_000_000_000)
    probe_url = f"{CAS_CAPTCHA_URL}?_={ts}"
    info = {"url": probe_url, "ok": False}
    try:
        req = urllib.request.Request(probe_url, method="GET")
        req.add_header("Accept", "image/avif,image/webp,image/apng,image/*,*/*;q=0.8")
        req.add_header("Cache-Control", "no-cache")
        req.add_header("Pragma", "no-cache")
        referer_url = f"{CAS_LOGIN_URL}?service={urllib.parse.quote(CAS_SERVICE, safe='')}"
        req.add_header("Referer", referer_url)
        req.add_header("Origin", "https://auth2.shsmu.edu.cn")
        resp = opener.open(req, timeout=10)
        body = resp.read(512)
        ct = resp.headers.get("Content-Type", "")
        info["content_type"] = ct
        info["ok"] = True
        info["sample_len"] = len(body)
    except Exception as e:
        info["error"] = f"{type(e).__name__}: {e}"
    return info


def _captcha_url_candidates(primary_url):
    """Try several common SHSMU CAS captcha paths — img src patterns change over time."""
    urls = []
    seen = set()
    for u in (
        CAS_CAPTCHA_URL,
        primary_url,
        f"{CAS_BASE_URL}captcha",
        f"{CAS_BASE_URL}kaptcha.jpg",
        f"{CAS_BASE_URL}captcha.jpg",
        "https://auth2.shsmu.edu.cn/cas/captcha",
        "https://auth2.shsmu.edu.cn/cas/kaptcha.jpg",
    ):
        if u and u not in seen:
            seen.add(u)
            urls.append(u)
    return urls


def _do_cas_login(opener, fields, username, password, captcha_code=None, captcha_field=None, debug_info=None):
    """POST credentials to CAS and follow redirects to get authenticated session."""
    if debug_info is None:
        debug_info = {}
    # Use detected field names if available, otherwise fall back to defaults
    username_key = fields.pop("__username_field__", None) or "username"
    password_key = fields.pop("__password_field__", None) or "password"
    form_action = fields.pop("__form_action__", None)
    rsa_public_key = fields.pop("__rsa_public_key__", None)
    captcha_fields_csv = fields.pop("__captcha_fields__", "")
    captcha_fields_from_html = [x for x in captcha_fields_csv.split(",") if x]
    debug_info["username_key"] = username_key
    debug_info["password_key"] = password_key
    debug_info["captcha_field_detected"] = captcha_field
    debug_info["captcha_fields_from_html"] = captcha_fields_from_html
    debug_info["captcha_code_len"] = len(captcha_code) if isinstance(captcha_code, str) else 0


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
        "submit": "",            # browser includes the submit button value
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
        # Submit captcha_code to multiple possible field names.
        # Some CAS pages expose different captcha input names depending on layout.
        # We overwrite any existing (hidden) value to avoid "authcode is present but empty"
        # when our captcha_field detection is wrong.
        keys_to_set = {
            "captchaResponse",
            "captcha",
            "validateCode",
            "authcode",
            "authCode",
            "auth_code",
            "code",
            "captcha_code",
            "captchaCode",
            "captchacode",
            "verifyCode",
            "verifycode",
            "validate_code",
            "checkCode",
            "checkcode",
            "randCode",
            "randcode",
            "imageCode",
            "imagecode",
        }
        if captcha_field:
            keys_to_set.add(captcha_field)
        for nm in captcha_fields_from_html:
            keys_to_set.add(nm)

        for field_name in keys_to_set:
            post_data[field_name] = captcha_code
        debug_info["captcha_keys_set"] = sorted(list(keys_to_set))

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
    debug_info["final_url"] = final_url
    debug_info["server_region"] = os.environ.get("FLY_REGION", "")
    debug_info["server_hostname"] = os.environ.get("HOSTNAME", "")
    debug_info["response_len"] = len(result_html)
    debug_info["cas_text_excerpt"] = _extract_visible_text(result_html, 260)

    # Hard-fail with a clear infrastructure diagnosis when backend traffic is
    # rewritten to WebVPN. This is not a user credential/captcha error.
    if "webvpn2.shsmu.edu.cn" in final_url.lower():
        debug_info["webvpn_redirect_detected"] = True
        err_msg = (
            "CAS access was redirected to SHSMU WebVPN by the backend network path. "
            "This backend cannot complete CAS SSO from the current egress network."
        )
        debug_info["final_error"] = err_msg
        print("[cas-login] WebVPN redirect detected in final_url; aborting with infrastructure error.")
        return False, err_msg

    # Some CAS layouts return the page URL still under /cas/login even when a
    # service ticket is embedded in HTML. Try to extract an ST-* token and
    # follow it explicitly before declaring failure.
    try:
        ticket_m_any = re.search(r'(ST-[A-Za-z0-9-]+)', result_html)
        if ticket_m_any:
            ticket_val = ticket_m_any.group(1)
            redirect_url = f"{CAS_SERVICE}?ticket={ticket_val}"
            print(f"[cas-login] Found ST-* ticket in response HTML; following: {redirect_url}")
            debug_info["ticket_in_html"] = True
            resp2 = opener.open(redirect_url, timeout=15)
            final_url = resp2.url
            return True, final_url
    except Exception as e:
        print(f"[cas-login] Ticket auto-follow failed: {type(e).__name__}: {e}")
        debug_info["ticket_auto_follow_failed"] = f"{type(e).__name__}: {e}"

    # Check if login succeeded (redirected away from CAS login page)
    if "cas/login" in final_url.lower() and "ticket" not in final_url.lower():
        # Record network/security warning but keep legacy flow alive.
        # Historically this project worked on ModelScope with older logic.
        if re.search(r'Non-secure Connection|Single Sign On WILL NOT WORK|MUST log in over HTTPS', result_html, re.I):
            debug_info["non_secure_connection_page"] = True
            print("[cas-login] Non-secure/WebVPN warning detected; continuing legacy redirect parsing.")

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

        # Detect two-factor / verification page (credentials accepted but
        # CAS requires phone or email verification before granting ticket).
        value_m = re.search(r'var\s+value\s*=\s*["\']?([^;\s"\']+)', result_html)
        if value_m and value_m.group(1) not in ("null", "None", ""):
            print(f"[cas-login] 2FA / verification page detected: value={value_m.group(1)}")
            # Credentials were accepted. Try submitting the form again
            # without captcha (the CAS may auto-redirect after first auth step).
            # Extract the new form action and hidden fields from this page.
            new_form_m = re.search(r'<form[^>]*id=["\']fm1["\'][^>]*action=["\']([^"\']+)["\']', result_html, re.I)
            new_lt_m = re.search(r'name=["\']lt["\'][^>]*value=["\']([^"\']*)["\']', result_html, re.I)
            new_exec_m = re.search(r'name=["\']execution["\'][^>]*value=["\']([^"\']*)["\']', result_html, re.I)
            if new_form_m:
                new_action = new_form_m.group(1)
                if new_action.startswith("/"):
                    new_url = f"https://auth2.shsmu.edu.cn{new_action}"
                else:
                    new_url = new_action
                new_post = {
                    "username": username,
                    "password": actual_password,
                    "_eventId": "submit",
                    "submit": "",
                }
                if new_lt_m:
                    new_post["lt"] = new_lt_m.group(1)
                if new_exec_m:
                    new_post["execution"] = new_exec_m.group(1)
                if rsa_public_key:
                    new_post["sessionKey"] = rsa_public_key
                new_body = urllib.parse.urlencode(new_post).encode("utf-8")
                new_req = urllib.request.Request(new_url, data=new_body, method="POST")
                new_req.add_header("Content-Type", "application/x-www-form-urlencoded")
                new_req.add_header("Referer", post_url)
                new_req.add_header("Origin", "https://auth2.shsmu.edu.cn")
                try:
                    resp3 = opener.open(new_req, timeout=15)
                    final_url = resp3.url
                    print(f"[cas-login] 2FA resubmit final URL: {final_url}")
                    if "cas/login" not in final_url.lower() or "ticket" in final_url.lower():
                        return True, final_url
                except Exception as e2fa:
                    print(f"[cas-login] 2FA resubmit failed: {e2fa}")
            return False, "Login requires additional verification (phone/email). Please log in via browser first."

        # Still on login page - extract error message
        # SHSMU CAS actual structure (verified):
        #   <span id="errormsg" ...>
        #     <div id="msg" class="errors">error text</div>
        #   </span>
        err_msg = ""

        # ── Strategy 1: Look for the specific SHSMU structure ──
        # The real CAS page puts errors inside <span id="errormsg"><div id="msg" class="errors">TEXT</div></span>
        inner_msg_m = re.search(
            r'<div[^>]*id=["\']msg["\'][^>]*class=["\'][^"\']*errors[^"\']*["\'][^>]*>([^<]+)</div>',
            result_html, re.I,
        )
        if inner_msg_m:
            text = inner_msg_m.group(1).strip()
            if text and "non-secure" not in text.lower() and "single sign on" not in text.lower():
                err_msg = text
                print(f"[cas-login] Error extracted (strategy 1 - msg div): {err_msg}")

        # ── Strategy 2: errormsg span with nested content ──
        if not err_msg:
            span_m = re.search(
                r'<span[^>]*id=["\']errormsg["\'][^>]*>(.*?)</span>',
                result_html, re.I | re.DOTALL,
            )
            if span_m:
                text = re.sub(r'<[^>]+>', '', span_m.group(1)).strip()
                if text and "non-secure" not in text.lower() and "single sign on" not in text.lower():
                    err_msg = text
                    print(f"[cas-login] Error extracted (strategy 2 - errormsg span): {err_msg}")

        # ── Strategy 3: errormsghide div (some CAS versions) ──
        if not err_msg:
            hide_m = re.search(
                r'id=["\']errormsghide["\'][^>]*>(.*?)</(?:div|span)>',
                result_html, re.I | re.DOTALL,
            )
            if hide_m:
                text = re.sub(r'<[^>]+>', '', hide_m.group(1)).strip()
                if text:
                    err_msg = text
                    print(f"[cas-login] Error extracted (strategy 3 - errormsghide): {err_msg}")

        # ── Strategy 4: Any element with class containing 'errors' ──
        if not err_msg:
            for m in re.finditer(r'class=["\'][^"\']*errors?[^"\']*["\'][^>]*>([^<]+)', result_html, re.I):
                text = m.group(1).strip()
                if text and "non-secure" not in text.lower() and "single sign on" not in text.lower() and len(text) < 200:
                    err_msg = text
                    print(f"[cas-login] Error extracted (strategy 4 - errors class): {err_msg}")
                    break

        # ── Strategy 5: Bootstrap alert / panel text ──
        if not err_msg:
            alert_m = re.search(
                r'class=["\'][^"\']*(?:alert|alert-danger|alert-warning)[^"\']*["\'][^>]*>([^<]+)',
                result_html, re.I,
            )
            if alert_m:
                text = re.sub(r'<[^>]+>', '', alert_m.group(1)).strip()
                if (
                    text
                    and len(text) < 300
                    and "non-secure" not in text.lower()
                    and "single sign on will not work" not in text.lower()
                    and "must log in over https" not in text.lower()
                ):
                    err_msg = text
                    print(f"[cas-login] Error extracted (strategy 5 - alert): {err_msg}")

        # ── Strategy 6: msg div without strict class match ──
        if not err_msg:
            loose_msg_m = re.search(
                r'<div[^>]*id=["\']msg["\'][^>]*>(.*?)</div>',
                result_html, re.I | re.DOTALL,
            )
            if loose_msg_m:
                text = re.sub(r'<[^>]+>', '', loose_msg_m.group(1)).strip()
                if text and "non-secure" not in text.lower() and len(text) < 300:
                    err_msg = text
                    print(f"[cas-login] Error extracted (strategy 6 - msg div loose): {err_msg}")

        # ── Strategy 7: captcha / verification hint (no explicit error text) ──
        # Do NOT trigger just because the page contains a captcha input widget.
        # Some CAS pages always render the captcha form even for other failures.
        if (
            not err_msg
            and not debug_info.get("non_secure_connection_page")
            and re.search(
            r'(请输入验证码|验证码(错误|不正确|失败)|verification code.*(error|invalid)|authcode.*(error|invalid))',
            result_html,
            re.I,
            )
        ):
            visible = _extract_visible_text(result_html, 160)
            err_msg = (
                "Captcha may be required or was incorrect. "
                "If a verification code is shown, submit it and try again."
            )
            if visible:
                err_msg = f"{err_msg} CAS hint: {visible}"
            print(f"[cas-login] Error inferred (strategy 7 - captcha-specific): {err_msg}")
            debug_info["captcha_error_inferred"] = True

        if not err_msg:
            # Log a large snippet of the response for debugging
            body_snippet = result_html[:2000]
            print(f"[cas-login] No error message extracted from CAS response. Response snippet:\n{body_snippet}")
            visible = _extract_visible_text(result_html, 200)
            if visible and not debug_info.get("non_secure_connection_page"):
                err_msg = f"CAS login failed. CAS page says: {visible}"
            else:
                err_msg = (
                    "CAS login did not return a service ticket. "
                    "Please verify account/password/captcha and try again."
                )

        # Do not surface CAS Non-secure banner as the final error message.
        # Keep diagnostics in details while returning a user-actionable message.
        if (
            debug_info.get("non_secure_connection_page")
            and err_msg
            and (
                "non-secure connection" in err_msg.lower()
                or "single sign on will not work" in err_msg.lower()
                or "must log in over https" in err_msg.lower()
            )
        ):
            err_msg = (
                "CAS login failed without receiving a service ticket. "
                "Please retry the captcha or credentials."
            )
            print("[cas-login] Replaced non-secure banner text with actionable error message.")
        debug_info["final_error"] = err_msg
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
            _get_agent().reload_config()
            self._send_json(200, {"status": "ok", "message": "Agent config reloaded"})
            return

        # Version check endpoint to verify which app.py is deployed
        if self.path == "/api/version":
            self._send_json(200, {"version": APP_VERSION})
            return
        if self.path == "/api/timetable/runtime":
            self._handle_timetable_runtime_get()
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
        elif self.path == "/api/timetable/register-tunnel":
            self._handle_timetable_runtime_register()
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
        elif self.path.startswith("/api/timetable/"):
            # CORS preflight for external timetable backend access
            self.send_response(204)
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization, X-API-Key, bypass-tunnel-reminder")
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
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def _handle_timetable_runtime_get(self) -> None:
        self._send_json(
            200,
            {
                "url": _runtime_tunnel_url,
                "updated_at": _runtime_tunnel_updated_at,
                "version": APP_VERSION,
            },
        )

    def _handle_timetable_runtime_register(self) -> None:
        try:
            body = self._read_body()
            url = str(body.get("url", "")).strip().rstrip("/")
            token = str(body.get("token", "")).strip()
            if REGISTER_TOKEN and token != REGISTER_TOKEN:
                self._send_json(403, {"error": "Invalid register token"})
                return
            if not (url.startswith("https://") or url.startswith("http://")):
                self._send_json(400, {"error": "url must start with http:// or https://"})
                return
            _save_runtime_tunnel_state(url)
            print(f"[runtime-tunnel] registered: {_runtime_tunnel_url}")
            self._send_json(
                200,
                {"ok": True, "url": _runtime_tunnel_url, "updated_at": _runtime_tunnel_updated_at},
            )
        except Exception as e:
            self._send_json(500, {"error": f"register failed: {e}"})

    def _proxy_timetable_sync(self, tunnel_base: str, raw_body: bytes) -> bool:
        target = f"{tunnel_base}/api/timetable/sync"
        try:
            req = urllib.request.Request(target, data=raw_body, method="POST")
            req.add_header("Content-Type", self.headers.get("Content-Type", "application/json"))
            req.add_header("X-Timetable-Forwarded", "1")
            if ".loca.lt" in tunnel_base:
                req.add_header("bypass-tunnel-reminder", "1")
            with urllib.request.urlopen(req, timeout=35) as resp:
                data = resp.read()
                self.send_response(resp.getcode())
                self.send_header("Content-Type", resp.headers.get("Content-Type", "application/json"))
                self.send_header("Content-Length", str(len(data)))
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(data)
                return True
        except urllib.error.HTTPError as e:
            data = e.read() if hasattr(e, "read") else b""
            self.send_response(e.code)
            self.send_header("Content-Type", e.headers.get("Content-Type", "application/json"))
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            if data:
                self.wfile.write(data)
            return True
        except Exception as e:
            self._send_json(502, {"error": f"Tunnel proxy failed: {e}", "target": target})
            return True

    def _handle_agent_comment(self) -> None:
        try:
            ag = _get_agent()
            body = self._read_body()
            content = body.get("content", "")
            style = body.get("style", "Neutral")
            if not content.strip():
                self._send_json(400, {"error": "content is required"})
                return
            result = ag.generate_comment(content, style=style)
            self._send_json(200, result)
        except Exception as e:
            self._send_json(500, {"error": str(e)})

    def _handle_agent_score(self) -> None:
        try:
            ag = _get_agent()
            body = self._read_body()
            content = body.get("content", "")
            style = body.get("style", "Neutral")
            if not content.strip():
                self._send_json(400, {"error": "content is required"})
                return
            result = ag.generate_comment_with_score(content, style=style)
            self._send_json(200, result)
        except Exception as e:
            self._send_json(500, {"error": str(e)})

    def _handle_agent_chat(self) -> None:
        try:
            ag = _get_agent()
            body = self._read_body()
            content = body.get("content", "")
            history = body.get("history", [])
            message = body.get("message", "")
            style = body.get("style", "Neutral")
            if not content.strip() or not message.strip():
                self._send_json(400, {"error": "content and message are required"})
                return
            result = ag.continue_conversation(content, history, message, style=style)
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
            if (
                _runtime_tunnel_url
                and self.headers.get("X-Timetable-Forwarded", "") != "1"
            ):
                raw_body = json.dumps(body, ensure_ascii=False).encode("utf-8")
                if self._proxy_timetable_sync(_runtime_tunnel_url, raw_body):
                    return

            username = body.get("username", "").strip()
            password = body.get("password", "").strip()
            session_id = body.get("session_id", "")
            captcha_code = body.get("captcha_code", "")
            if isinstance(captcha_code, str):
                # Avoid trailing/leading whitespace making the captcha always fail.
                captcha_code = captcha_code.strip()
            debug = bool(body.get("debug", False))

            if not username or not password:
                self._send_json(400, {"error": "username and password are required"})
                return

            print(f"[timetable-sync] Request: username={username}, session_id={session_id[:8] if session_id else 'none'}, captcha_code={captcha_code or 'none'}")

            # Phase 2: Resume a session with captcha answer
            if session_id:
                if session_id not in _cas_sessions:
                    print(f"[timetable-sync] Session {session_id[:8]}... NOT FOUND (server restarted or expired). Starting fresh Phase 1.")
                    # Fall through to Phase 1 below
                else:
                    sess = _cas_sessions.pop(session_id)
                    opener, _ = _build_opener(sess["cookie_jar"])

                    # Use the saved fields directly. Do NOT re-fetch the CAS page here!
                    # The captcha answer the user provides is tied to the lt/execution tokens
                    # and session cookies saved in Phase 1. Re-fetching would generate a new
                    # captcha challenge on the server, invalidating the user's answer.
                    use_fields = sess["fields"]
                    use_captcha_field = sess.get("captcha_field")

                    print(f"[timetable-sync] Phase 2: resuming session, captcha_code={captcha_code}, captcha_field={use_captcha_field}, lt={use_fields.get('lt', 'N/A')[:20] if use_fields.get('lt') else 'N/A'}...")
                    dbg = {"phase": 2, "session_found": True, "captcha_field_saved": use_captcha_field}
                    ok, result = _do_cas_login(
                        opener, use_fields, username, password, captcha_code,
                        captcha_field=use_captcha_field,
                        debug_info=dbg,
                    )
                    if not ok:
                        payload = {"error": result, "details": dbg}
                        if debug:
                            payload["debug"] = dbg
                        self._send_json(401, payload)
                        return

                    courses = _fetch_timetable(opener)
                    if isinstance(courses, dict) and "error" in courses:
                        self._send_json(200, {"courses": [], "warning": courses["error"]})
                    else:
                        self._send_json(200, {"courses": courses})
                    return

            # Phase 1: Fresh login attempt
            # WebVPN rewrites are sometimes intermittent. Retry a few times and
            # only continue when we get a clean CAS login page.
            opener = None
            cookie_jar = None
            fields = None
            captcha_url = None
            captcha_field = None
            phase1_attempts = []
            for attempt_idx in range(1, 4):
                opener_try, cookie_jar_try = _build_opener()
                fields_try, captcha_url_try, html_try, captcha_field_try, final_url_try = _fetch_cas_login_page(opener_try)

                form_action_try = str(fields_try.get("_form_action", "") or "")
                html_l = (html_try or "").lower()
                webvpn_in_phase1 = (
                    "webvpn2.shsmu.edu.cn" in (final_url_try or "").lower()
                    or
                    "webvpn2.shsmu.edu.cn" in form_action_try.lower()
                    or "webvpn2.shsmu.edu.cn" in html_l
                )

                phase1_attempts.append(
                    {
                        "attempt": attempt_idx,
                        "final_url": str(final_url_try or "")[:300],
                        "form_action": form_action_try[:300],
                        "webvpn_like_page": webvpn_in_phase1,
                    }
                )

                if webvpn_in_phase1:
                    print(f"[timetable-sync] Phase 1 attempt {attempt_idx}: WebVPN-like CAS page detected, retrying...")
                    continue

                opener = opener_try
                cookie_jar = cookie_jar_try
                fields = fields_try
                captcha_url = captcha_url_try
                captcha_field = captcha_field_try
                break

            if not opener or not fields:
                payload = {
                    "error": (
                        "CAS login page was repeatedly redirected to SHSMU WebVPN. "
                        "Please retry in a moment."
                    ),
                    "details": {
                        "phase": 1,
                        "webvpn_redirect_detected": True,
                        "phase1_attempts": phase1_attempts,
                        "server_region": os.environ.get("FLY_REGION", ""),
                        "server_hostname": os.environ.get("HOSTNAME", ""),
                    },
                }
                self._send_json(503, payload)
                return

            if captcha_url:
                # Captcha required - fetch image and return to user for manual entry.
                # Do NOT auto-solve or consume the lt/execution tokens here.
                # The tokens must remain fresh for Phase 2 when the user submits.
                captcha_b64 = None
                last_cap_err = None
                attempts = []
                candidates = [CAS_CAPTCHA_URL]
                # Per user request, fetch captcha directly from fixed URL.
                attempts.append(_probe_captcha_url(opener, CAS_CAPTCHA_URL))
                try:
                    captcha_b64, _ = _fetch_captcha_image(opener, CAS_CAPTCHA_URL)
                    print(f"[timetable-sync] Captcha image loaded from fixed URL: {CAS_CAPTCHA_URL}")
                except Exception as e:
                    last_cap_err = e
                    print(f"[timetable-sync] Captcha fetch failed for fixed URL {CAS_CAPTCHA_URL}: {e}")

                if not captcha_b64:
                    payload = {
                        "error": f"Could not load captcha image from CAS. Please try again later. ({last_cap_err})",
                        "app_version": APP_VERSION,
                        "debug": {
                            "phase": 1,
                            "captcha_field_detected": captcha_field,
                            "captcha_url_from_html": captcha_url,
                            "captcha_candidates": candidates,
                            "captcha_probe_attempts": attempts,
                            "phase1_attempts": phase1_attempts,
                        },
                    }
                    self._send_json(500, payload)
                    return

                print(f"[timetable-sync] Phase 1: captcha required, returning to user (lt={fields.get('lt', 'N/A')[:20]}...)")

                sid = str(uuid.uuid4())
                _cas_sessions[sid] = {"cookie_jar": cookie_jar, "fields": fields, "captcha_field": captcha_field}
                resp_payload = {
                    "captcha_required": True,
                    "captcha_image": captcha_b64,
                    "session_id": sid,
                }
                if debug:
                    resp_payload["debug"] = {
                        "phase": 1,
                        "captcha_field_detected": captcha_field,
                        "captcha_url_from_html": captcha_url,
                        "captcha_candidates": candidates,
                        "captcha_probe_attempts": attempts,
                        "phase1_attempts": phase1_attempts,
                    }
                self._send_json(200, resp_payload)
                return

            # No captcha - proceed directly
            dbg = {
                "phase": 1,
                "session_found": False,
                "captcha_field_saved": captcha_field,
                "phase1_attempts": phase1_attempts,
            }
            ok, result = _do_cas_login(opener, fields, username, password, debug_info=dbg)
            if not ok:
                payload = {"error": result, "details": dbg}
                if debug:
                    payload["debug"] = dbg
                self._send_json(401, payload)
                return

            courses = _fetch_timetable(opener)
            if isinstance(courses, dict) and "error" in courses:
                self._send_json(200, {"courses": [], "warning": courses["error"]})
            else:
                self._send_json(200, {"courses": courses})

        except Exception as e:
            print(f"[timetable-sync] EXCEPTION: {type(e).__name__}: {e}")
            traceback.print_exc()
            self._send_json(500, {"error": f"Timetable sync failed: {type(e).__name__}: {str(e)}", "app_version": APP_VERSION})

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
            try:
                self.send_response(502)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(error_msg)))
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(error_msg)
            except BrokenPipeError:
                print("[supabase-proxy] client closed connection before error response was sent")


def main():
    _load_runtime_tunnel_state()
    print(f"Duo Journal - Serving from {DIST_DIR}")
    print(f"Agent config loaded from {CONFIG_DIR}")
    if _runtime_tunnel_url:
        print(f"Runtime tunnel loaded: {_runtime_tunnel_url} (updated={_runtime_tunnel_updated_at})")
    print(f"Starting server on port {PORT}...")

    with socketserver.ThreadingTCPServer(("0.0.0.0", PORT), SPAHandler) as httpd:
        print(f"Server running at http://0.0.0.0:{PORT}")
        httpd.serve_forever()


if __name__ == "__main__":
    main()

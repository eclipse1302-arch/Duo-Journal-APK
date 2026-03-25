"""Simulate Phase 1 + Phase 2 of the timetable sync CAS login flow."""
import sys
sys.stdout.reconfigure(encoding='utf-8')
import urllib.request
import ssl
import http.cookiejar
import urllib.parse
import re
import base64
import pickle

ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE

def build_opener(cj=None):
    if cj is None:
        cj = http.cookiejar.CookieJar()
    ch = urllib.request.HTTPCookieProcessor(cj)
    hh = urllib.request.HTTPSHandler(context=ctx)
    op = urllib.request.build_opener(ch, hh)
    op.addheaders = [
        ('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'),
        ('Accept', 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'),
        ('Accept-Language', 'zh-CN,zh;q=0.9,en;q=0.8'),
    ]
    return op, cj

CAS_SERVICE = 'https://jwstu.shsmu.edu.cn/Login/authLogin'
CAS_LOGIN_URL = 'https://auth2.shsmu.edu.cn/cas/login'

MODE = sys.argv[1] if len(sys.argv) > 1 else 'phase1'

if MODE == 'phase1':
    print('=== PHASE 1: Fetch CAS page + captcha ===')
    opener, cookie_jar = build_opener()
    url = f'{CAS_LOGIN_URL}?service={urllib.parse.quote(CAS_SERVICE, safe="")}'
    resp = opener.open(url, timeout=15)
    html = resp.read().decode('utf-8', errors='replace')
    print(f'Page loaded ({len(html)} bytes)')

    # Extract hidden fields
    fields = {}
    for m in re.finditer(r'<input[^>]+type=["\']hidden["\'][^>]*>', html, re.I):
        tag = m.group(0)
        nm = re.search(r'name=["\']([^"\']+)["\']', tag)
        vm = re.search(r'value=["\']([^"\']*)["\']', tag)
        if nm:
            fields[nm.group(1)] = vm.group(1) if vm else ''

    form_m = re.search(r'<form[^>]*id=["\']fm1["\'][^>]*action=["\']([^"\']+)["\']', html, re.I)
    if form_m:
        fields['__form_action__'] = form_m.group(1)

    rsa_m = re.search(r'var\s+login_Key\s*=\s*["\']([A-Za-z0-9+/=]+)["\']', html)
    if rsa_m:
        fields['__rsa_public_key__'] = rsa_m.group(1)

    captcha_field = None
    cap_field_m = re.search(r'<input[^>]*name=["\'](\w*captcha\w*|authcode|validateCode|code)["\']', html, re.I)
    if cap_field_m:
        captcha_field = cap_field_m.group(1)

    print(f'Fields: {[k for k in fields.keys()]}')
    print(f'lt={fields.get("lt", "N/A")[:30]}...')
    print(f'captcha_field={captcha_field}')

    # Fetch captcha
    cap_m = re.search(r'<img[^>]+src=["\']([^"\']*captcha[^"\']*)["\']', html, re.I)
    cap_url = cap_m.group(1) if cap_m else None
    if cap_url and not cap_url.startswith('http'):
        if cap_url.startswith('/'):
            cap_url = f'https://auth2.shsmu.edu.cn{cap_url}'
        else:
            cap_url = f'https://auth2.shsmu.edu.cn/cas/{cap_url}'
    print(f'Captcha URL: {cap_url}')
    cap_resp = opener.open(cap_url, timeout=10)
    cap_bytes = cap_resp.read()
    print(f'Captcha fetched ({len(cap_bytes)} bytes)')

    with open('phase1_captcha.png', 'wb') as f:
        f.write(cap_bytes)

    for c in cookie_jar:
        print(f'Cookie: {c.name}={c.value[:20]}...')

    # Save session state using JSON-safe format
    cookies_data = []
    for c in cookie_jar:
        cookies_data.append({
            'name': c.name, 'value': c.value, 'domain': c.domain,
            'path': c.path, 'secure': c.secure,
        })

    import json
    with open('test_session.json', 'w') as f:
        json.dump({
            'cookies': cookies_data,
            'fields': dict(fields),
            'captcha_field': captcha_field,
        }, f)
    print(f'\nSession saved. Now look at phase1_captcha.png and run:')
    print(f'  python test_phase12.py phase2 <captcha_answer>')

elif MODE == 'phase2':
    captcha_answer = sys.argv[2] if len(sys.argv) > 2 else None
    if not captcha_answer:
        print('Usage: python test_phase12.py phase2 <captcha_answer>')
        sys.exit(1)

    print(f'=== PHASE 2: Submit with captcha answer={captcha_answer} ===')

    import json
    with open('test_session.json', 'r') as f:
        sess = json.load(f)

    # Rebuild cookie jar from saved cookies
    cookie_jar = http.cookiejar.CookieJar()
    for cd in sess['cookies']:
        cookie = http.cookiejar.Cookie(
            version=0, name=cd['name'], value=cd['value'],
            port=None, port_specified=False,
            domain=cd['domain'], domain_specified=True, domain_initial_dot=cd['domain'].startswith('.'),
            path=cd['path'], path_specified=True,
            secure=cd['secure'], expires=None, discard=True,
            comment=None, comment_url=None, rest={}, rfc2109=False,
        )
        cookie_jar.set_cookie(cookie)

    fields = sess['fields']
    captcha_field = sess.get('captcha_field')

    opener, _ = build_opener(cookie_jar)

    # Extract special fields
    form_action = fields.pop('__form_action__', None)
    rsa_public_key = fields.pop('__rsa_public_key__', None)

    print(f'Fields: {[k for k in fields.keys()]}')
    print(f'form_action={form_action}')
    print(f'rsa_public_key={rsa_public_key is not None}')
    print(f'captcha_field={captcha_field}')

    # Encrypt password
    from cryptography.hazmat.primitives.asymmetric import padding as asym_padding
    from cryptography.hazmat.primitives import serialization

    def rsa_encrypt(plaintext, pub_key_b64):
        pem_lines = ['-----BEGIN PUBLIC KEY-----']
        for i in range(0, len(pub_key_b64), 64):
            pem_lines.append(pub_key_b64[i:i + 64])
        pem_lines.append('-----END PUBLIC KEY-----')
        pem_bytes = '\n'.join(pem_lines).encode('utf-8')
        public_key = serialization.load_pem_public_key(pem_bytes)
        encrypted = public_key.encrypt(plaintext.encode('utf-8'), asym_padding.PKCS1v15())
        return base64.b64encode(encrypted).decode('ascii')

    # Use dummy credentials (we want to see if CAS gives "wrong password" error,
    # not "captcha wrong" error)
    username = '20999999'
    password = 'WrongPassword123!'

    actual_password = password
    if rsa_public_key:
        actual_password = rsa_encrypt(password, rsa_public_key)
        print(f'Password encrypted ({len(actual_password)} chars)')

    post_data = {
        'username': username,
        'password': actual_password,
        '_eventId': 'submit',
        'submit': '',
    }
    for k, v in fields.items():
        if k not in post_data and not k.startswith('__'):
            post_data[k] = v
    if rsa_public_key:
        post_data['sessionKey'] = rsa_public_key
    if captcha_field:
        post_data[captcha_field] = captcha_answer
    if 'authcode' not in post_data:
        post_data['authcode'] = captcha_answer

    # Build POST URL
    if form_action:
        if form_action.startswith('http'):
            post_url = form_action
        elif form_action.startswith('/'):
            post_url = f'https://auth2.shsmu.edu.cn{form_action}'
        else:
            post_url = f'{CAS_LOGIN_URL}/{form_action}'
        if 'service=' not in post_url:
            sep = '&' if '?' in post_url else '?'
            post_url = f'{post_url}{sep}service={urllib.parse.quote(CAS_SERVICE, safe="")}'
    else:
        post_url = f'{CAS_LOGIN_URL}?service={urllib.parse.quote(CAS_SERVICE, safe="")}'

    print(f'\nPOST URL: {post_url}')
    print(f'POST fields: {list(post_data.keys())}')

    body = urllib.parse.urlencode(post_data).encode('utf-8')
    req = urllib.request.Request(post_url, data=body, method='POST')
    req.add_header('Content-Type', 'application/x-www-form-urlencoded')
    req.add_header('Referer', f'{CAS_LOGIN_URL}?service={urllib.parse.quote(CAS_SERVICE, safe="")}')
    req.add_header('Origin', 'https://auth2.shsmu.edu.cn')

    try:
        resp = opener.open(req, timeout=15)
        result_html = resp.read().decode('utf-8', errors='replace')
        final_url = resp.url
        print(f'\nResponse: {len(result_html)} bytes, URL: {final_url}')
        print(f'Still on CAS? {"cas/login" in final_url.lower()}')

        # Try all error extraction strategies
        err_msg = ""

        # Strategy 1
        m = re.search(r'<div[^>]*id=["\']msg["\'][^>]*class=["\'][^"\']*errors[^"\']*["\'][^>]*>([^<]+)</div>', result_html, re.I)
        if m:
            text = m.group(1).strip()
            if text and "non-secure" not in text.lower():
                err_msg = text
                print(f'Strategy 1 (msg div): "{err_msg}"')

        # Strategy 2
        if not err_msg:
            m = re.search(r'<span[^>]*id=["\']errormsg["\'][^>]*>(.*?)</span>', result_html, re.I | re.DOTALL)
            if m:
                text = re.sub(r'<[^>]+>', '', m.group(1)).strip()
                if text and "non-secure" not in text.lower() and "single sign on" not in text.lower():
                    err_msg = text
                    print(f'Strategy 2 (errormsg span): "{err_msg}"')

        # Strategy 3
        if not err_msg:
            m = re.search(r'id=["\']errormsghide["\'][^>]*>(.*?)</(?:div|span)>', result_html, re.I | re.DOTALL)
            if m:
                text = re.sub(r'<[^>]+>', '', m.group(1)).strip()
                if text:
                    err_msg = text
                    print(f'Strategy 3 (errormsghide): "{err_msg}"')

        # Strategy 4
        if not err_msg:
            for m in re.finditer(r'class=["\'][^"\']*errors?[^"\']*["\'][^>]*>([^<]+)', result_html, re.I):
                text = m.group(1).strip()
                if text and "non-secure" not in text.lower() and "single sign on" not in text.lower() and len(text) < 200:
                    err_msg = text
                    print(f'Strategy 4 (errors class): "{err_msg}"')
                    break

        if err_msg:
            is_captcha_err = '验证码' in err_msg
            print(f'\n*** ERROR EXTRACTED: "{err_msg}" ***')
            print(f'*** Is captcha error: {is_captcha_err} ***')
        else:
            print('\n*** NO ERROR EXTRACTED - strategies 1-4 all failed ***')
            # Show raw errormsg area
            idx = result_html.find('errormsg')
            if idx >= 0:
                start = max(0, idx - 30)
                end = min(len(result_html), idx + 500)
                print(f'Raw HTML near errormsg:\n{result_html[start:end]}')
            else:
                print('No "errormsg" found in response at all')
                print(f'First 1000 chars:\n{result_html[:1000]}')

    except Exception as e:
        import traceback
        print(f'EXCEPTION: {e}')
        traceback.print_exc()

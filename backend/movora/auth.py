"""Password hashing (PBKDF2) and signed session tokens — standard library only.

Single-admin auth for v0.5; the User/role model already supports multi-user + RBAC
for v1. The signed token is stateless (no sessions table) and carries an expiry.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import secrets
import time

_ALGORITHM = "pbkdf2_sha256"
_ITERATIONS = 600_000


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, _ITERATIONS)
    return f"{_ALGORITHM}${_ITERATIONS}${_b64(salt)}${_b64(digest)}"


def verify_password(password: str, encoded: str) -> bool:
    try:
        algorithm, iterations_str, salt_b64, digest_b64 = encoded.split("$")
        if algorithm != _ALGORITHM:
            return False
        salt = _unb64(salt_b64)
        expected = _unb64(digest_b64)
        digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, int(iterations_str))
    except (ValueError, TypeError):
        return False
    return hmac.compare_digest(digest, expected)


def issue_token(user_id: int, secret: str, ttl_seconds: int) -> str:
    payload = f"{user_id}.{int(time.time()) + ttl_seconds}"
    return f"{payload}.{_sign(payload, secret)}"


def read_token(token: str, secret: str) -> int | None:
    try:
        user_id_str, expiry_str, signature = token.rsplit(".", 2)
    except ValueError:
        return None
    payload = f"{user_id_str}.{expiry_str}"
    if not hmac.compare_digest(signature, _sign(payload, secret)):
        return None
    try:
        if int(expiry_str) < int(time.time()):
            return None
        return int(user_id_str)
    except ValueError:
        return None


def _sign(payload: str, secret: str) -> str:
    return hmac.new(secret.encode(), payload.encode(), hashlib.sha256).hexdigest()


def _b64(raw: bytes) -> str:
    return base64.b64encode(raw).decode()


def _unb64(text: str) -> bytes:
    return base64.b64decode(text)

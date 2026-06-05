from movora.auth import hash_password, issue_token, read_token, verify_password


def test_password_hash_roundtrip() -> None:
    encoded = hash_password("hunter2")
    assert encoded != "hunter2"
    assert verify_password("hunter2", encoded)
    assert not verify_password("wrong", encoded)


def test_password_hashes_are_salted() -> None:
    assert hash_password("same") != hash_password("same")


def test_verify_rejects_garbage() -> None:
    assert not verify_password("x", "not-a-valid-hash")


def test_token_roundtrip() -> None:
    token = issue_token(42, secret="s3cret", ttl_seconds=60)
    assert read_token(token, secret="s3cret") == 42


def test_token_rejects_wrong_secret() -> None:
    token = issue_token(42, secret="s3cret", ttl_seconds=60)
    assert read_token(token, secret="other") is None


def test_token_rejects_expired() -> None:
    token = issue_token(42, secret="s3cret", ttl_seconds=-1)
    assert read_token(token, secret="s3cret") is None


def test_token_rejects_tampered() -> None:
    token = issue_token(42, secret="s3cret", ttl_seconds=60)
    assert read_token(token + "x", secret="s3cret") is None

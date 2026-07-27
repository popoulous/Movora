# Security Policy

## Supported versions

Movora is developed on `main`; fixes land there first and reach users with the next
release. Only the most recent release receives security fixes — older tags are
point-in-time snapshots and are not patched.

## Reporting a vulnerability

**Please don't open a public issue for a security problem.**

Use GitHub's private vulnerability reporting instead: open the **Security** tab of this
repository and choose **Report a vulnerability**. The report stays private until a fix
exists, and the whole discussion lives in one place.

What helps most in a report:

- the affected release or commit, and how the server is deployed (Docker, native,
  behind a reverse proxy);
- what an attacker actually gains — reading another user's media, escaping the library
  directory, bypassing authentication;
- the shortest sequence that reproduces it.

Movora is a personal project without a support contract, so there is no guaranteed
response time. Expect an acknowledgement within a few days, and a fix once the problem
is understood.

## Scope

Movora serves media over HTTP, authenticates users, and hands long-lived tokens to TV
and mobile clients, so these are the parts worth attacking:

- authentication and session handling, including the login rate limit and the session
  cookie;
- the device pairing flow and the bearer tokens the TV and mobile clients hold —
  including the `?token=` query parameter, which exists because `<video>`, `<img>` and
  `<track>` elements cannot send an `Authorization` header;
- path handling in the streaming, subtitle, artwork and capability-sample routes:
  anything that escapes the configured library or data directory;
- the boundary between administrator and regular accounts.

Out of scope:

- deployment decisions the operator makes, such as exposing the server to the internet
  without TLS. The README's remote-access section describes the intended setup — a
  reverse proxy or a tunnel, with `MOVORA_COOKIE_SECURE=true`;
- vulnerabilities in third-party components (ffmpeg, FastAPI, the Python and npm
  dependencies). Report those upstream — though do flag them here if the way Movora
  uses them makes the impact worse;
- anything that already requires a compromised host or physical access to the machine
  running the server.

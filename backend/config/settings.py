"""Local-first defaults. Public hosting requires an explicit secret and hosts."""
import os
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

BASE_DIR = Path(__file__).resolve().parent.parent
DEBUG = os.getenv("DJANGO_DEBUG", "true").lower() == "true"
SECRET_KEY = os.getenv("DJANGO_SECRET_KEY", "proofline-development-only-do-not-deploy")
if not DEBUG and SECRET_KEY == "proofline-development-only-do-not-deploy":
    raise RuntimeError("Set DJANGO_SECRET_KEY when DJANGO_DEBUG=false.")
ALLOWED_HOSTS = os.getenv("DJANGO_ALLOWED_HOSTS", "localhost,127.0.0.1,[::1],testserver").split(",")
INSTALLED_APPS = [
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.staticfiles",
    "graphene_django",
    "followthrough",
]
MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]
ROOT_URLCONF = "config.urls"
WSGI_APPLICATION = "config.wsgi.application"
database_url = os.getenv("DATABASE_URL")
if database_url:
    parsed = urlparse(database_url)
    if parsed.scheme not in {"postgres", "postgresql"} or not parsed.hostname or not parsed.path.strip("/"):
        raise RuntimeError("DATABASE_URL must be a PostgreSQL URL with a host and database name.")
    query = parse_qs(parsed.query)
    unknown = set(query) - {"sslmode"}
    if unknown:
        raise RuntimeError("DATABASE_URL supports only the sslmode query parameter.")
    DATABASES = {"default": {
        "ENGINE": "django.db.backends.postgresql",
        "NAME": unquote(parsed.path.lstrip("/")),
        "USER": unquote(parsed.username or ""),
        "PASSWORD": unquote(parsed.password or ""),
        "HOST": parsed.hostname,
        "PORT": parsed.port or 5432,
        "OPTIONS": {"sslmode": query["sslmode"][0]} if "sslmode" in query else {},
        "CONN_MAX_AGE": 60,
    }}
else:
    DATABASES = {"default": {"ENGINE": "django.db.backends.sqlite3", "NAME": os.getenv("SQLITE_PATH", str(BASE_DIR / "db.sqlite3")), "OPTIONS": {"timeout": 20, "transaction_mode": "IMMEDIATE"}}}
GRAPHENE = {"SCHEMA": "followthrough.schema.schema"}
LANGUAGE_CODE = "en-us"
TIME_ZONE = "UTC"
USE_I18N = True
USE_TZ = True
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"
STATIC_URL = "/static/"
SESSION_COOKIE_HTTPONLY = True
SESSION_COOKIE_SAMESITE = "Lax"
SESSION_COOKIE_SECURE = not DEBUG
CSRF_COOKIE_SECURE = not DEBUG
CSRF_COOKIE_SAMESITE = "Lax"
SESSION_COOKIE_AGE = 60 * 60 * 24 * 30
# Allow a full 20k-character notes value even with JSON Unicode escaping.
DATA_UPLOAD_MAX_MEMORY_SIZE = 256 * 1024
X_FRAME_OPTIONS = "DENY"
SECURE_CONTENT_TYPE_NOSNIFF = True

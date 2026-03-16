import time
import logging
from collections import defaultdict

from fastapi import FastAPI, Request, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, FileResponse
from fastapi.staticfiles import StaticFiles

from backend.config import settings
from backend.models import (
    AnalyzeRequest,
    AnalyzeResponse,
    AnonymizeRequest,
    AnonymizeResponse,
    DeanonymizeRequest,
    DeanonymizeResponse,
)
from backend.anonymizer import PresidioService

# ---------------------------------------------------------------------------
# Logging — never log PII
# ---------------------------------------------------------------------------
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("clearllm")

# ---------------------------------------------------------------------------
# App
# ---------------------------------------------------------------------------
app = FastAPI(
    title="ClearLLM",
    description="Anonymisation de messages avant envoi aux LLM",
    version="1.0.0",
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
)

# ---------------------------------------------------------------------------
# CORS
# ---------------------------------------------------------------------------
origins = (
    ["*"]
    if settings.allowed_origins == "*"
    else [o.strip() for o in settings.allowed_origins.split(",")]
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_methods=["GET", "POST", "DELETE"],
    allow_headers=["Content-Type"],
    allow_credentials=False,
)

# ---------------------------------------------------------------------------
# Security headers middleware
# ---------------------------------------------------------------------------
@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["X-XSS-Protection"] = "1; mode=block"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["Permissions-Policy"] = (
        "camera=(), microphone=(), geolocation=(), interest-cohort=()"
    )
    response.headers["Content-Security-Policy"] = (
        "default-src 'self'; "
        "script-src 'self'; "
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
        "font-src 'self' https://fonts.gstatic.com; "
        "img-src 'self' data:; "
        "connect-src 'self'; "
        "frame-ancestors 'none'; "
        "base-uri 'self'; "
        "form-action 'self';"
    )
    response.headers["Strict-Transport-Security"] = (
        "max-age=63072000; includeSubDomains; preload"
    )
    return response


# ---------------------------------------------------------------------------
# Rate limiting (in-memory, per IP)
# ---------------------------------------------------------------------------
_rate_store: dict[str, list[float]] = defaultdict(list)


@app.middleware("http")
async def rate_limit(request: Request, call_next):
    if request.url.path.startswith("/api/"):
        client_ip = request.client.host if request.client else "unknown"
        now = time.time()
        window = 60.0
        hits = _rate_store[client_ip]
        # Trim old entries
        _rate_store[client_ip] = [t for t in hits if now - t < window]
        if len(_rate_store[client_ip]) >= settings.rate_limit_per_minute:
            return JSONResponse(
                status_code=429,
                content={"detail": "Trop de requêtes. Réessayez dans un instant."},
            )
        _rate_store[client_ip].append(now)
    return await call_next(request)


# ---------------------------------------------------------------------------
# Presidio service (singleton)
# ---------------------------------------------------------------------------
presidio: PresidioService | None = None


@app.on_event("startup")
async def startup():
    global presidio
    presidio = PresidioService()
    logger.info("ClearLLM ready.")


# ---------------------------------------------------------------------------
# API routes
# ---------------------------------------------------------------------------
@app.get("/api/health")
async def health():
    return {"status": "ok"}


@app.post("/api/analyze", response_model=AnalyzeResponse)
async def analyze(req: AnalyzeRequest):
    if len(req.text) > settings.max_text_length:
        raise HTTPException(status_code=413, detail="Texte trop long.")
    return presidio.analyze(text=req.text, language=req.language)


@app.post("/api/anonymize", response_model=AnonymizeResponse)
async def anonymize(req: AnonymizeRequest):
    if len(req.text) > settings.max_text_length:
        raise HTTPException(status_code=413, detail="Texte trop long.")
    return presidio.anonymize(text=req.text, language=req.language)


@app.post("/api/deanonymize", response_model=DeanonymizeResponse)
async def deanonymize(req: DeanonymizeRequest):
    try:
        result = presidio.deanonymize(session_id=req.session_id, text=req.text)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    return DeanonymizeResponse(deanonymized_text=result)


@app.delete("/api/session/{session_id}")
async def delete_session(session_id: str):
    presidio.delete_session(session_id)
    return {"status": "deleted"}


# ---------------------------------------------------------------------------
# Serve frontend
# ---------------------------------------------------------------------------
app.mount("/css", StaticFiles(directory="frontend/css"), name="css")
app.mount("/js", StaticFiles(directory="frontend/js"), name="js")


@app.get("/favicon.svg")
async def favicon():
    return FileResponse("frontend/favicon.svg", media_type="image/svg+xml")


@app.get("/")
async def index():
    return FileResponse("frontend/index.html")

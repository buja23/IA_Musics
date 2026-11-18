"""
Trap AI Studio — Ponto de Entrada da Aplicação
===============================================
Configuração do FastAPI, montagem de arquivos estáticos e inclusão
de rotas. Servidor de desenvolvimento via Uvicorn.

Uso:
    uvicorn main:app --reload --host 0.0.0.0 --port 8000
"""

from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager
from pathlib import Path
from typing import AsyncGenerator

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from routes.audio import router as audio_router
from services.job_manager import job_manager

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s │ %(levelname)-8s │ %(name)s │ %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("trap_ai_studio")

# ---------------------------------------------------------------------------
# Diretórios
# ---------------------------------------------------------------------------

BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"
OUTPUTS_DIR = STATIC_DIR / "outputs"
UPLOADS_DIR = BASE_DIR / "uploads"

# Garantir que existam na inicialização
STATIC_DIR.mkdir(exist_ok=True)
OUTPUTS_DIR.mkdir(exist_ok=True)
UPLOADS_DIR.mkdir(exist_ok=True)


# ---------------------------------------------------------------------------
# Lifecycle — pré-aquecimento do modelo
# ---------------------------------------------------------------------------

@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    """
    Ciclo de vida da aplicação.
    No startup, registra o loop de eventos no JobManager e faz log;
    no shutdown, limpa recursos.
    """
    job_manager.set_loop(asyncio.get_running_loop())
    logger.info("=" * 60)
    logger.info("  🎵  Trap AI Studio — Backend v0.2.0 (FASE 4A)")
    logger.info("  📂  Outputs: %s", OUTPUTS_DIR)
    logger.info("  📂  Uploads: %s", UPLOADS_DIR)
    logger.info("=" * 60)

    yield  # ← aplicação rodando

    logger.info("Trap AI Studio encerrado.")


# ---------------------------------------------------------------------------
# Instância do FastAPI
# ---------------------------------------------------------------------------

app = FastAPI(
    title="Trap AI Studio",
    description=(
        "Motor de processamento de áudio para beats de trap. "
        "Separação de stems via HTDemucs (Vocais, Bateria, Baixo/808, Melodia)."
    ),
    version="0.1.0",
    lifespan=lifespan,
    docs_url="/docs",
    redoc_url="/redoc",
)

# ---------------------------------------------------------------------------
# CORS — permitir frontend local durante desenvolvimento
# ---------------------------------------------------------------------------

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:3000",
        "*"
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["*"],
)

# ---------------------------------------------------------------------------
# Arquivos estáticos (stems gerados ficam acessíveis via /static/…)
# ---------------------------------------------------------------------------

app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")

# ---------------------------------------------------------------------------
# Rotas
# ---------------------------------------------------------------------------

app.include_router(audio_router)


# ---------------------------------------------------------------------------
# Health check
# ---------------------------------------------------------------------------

@app.get("/health", tags=["Sistema"])
async def health_check() -> dict[str, str]:
    """Verificação rápida de saúde do serviço."""
    return {"status": "ok", "service": "Trap AI Studio"}


# ---------------------------------------------------------------------------
# Execução direta
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=8000,
        reload=True,
        log_level="info",
    )


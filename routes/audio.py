"""
Trap AI Studio — Rota de Upload e Processamento de Áudio
========================================================
Endpoint POST /api/v1/process-beat que recebe um arquivo de áudio,
valida o formato e dispara a separação de stems via Demucs.
"""

from __future__ import annotations

import logging
import time
import uuid
from pathlib import Path

from fastapi import APIRouter, HTTPException, UploadFile, File, status
from pydantic import BaseModel

from services.demucs_service import (
    ProcessingResult,
    StemResult,
    UPLOAD_DIR,
    separate_stems,
)

logger = logging.getLogger("trap_ai_studio.routes.audio")

router = APIRouter(prefix="/api/v1", tags=["Áudio"])

# ---------------------------------------------------------------------------
# Constantes de validação
# ---------------------------------------------------------------------------

ALLOWED_EXTENSIONS: set[str] = {".mp3", ".wav"}
ALLOWED_CONTENT_TYPES: set[str] = {
    "audio/mpeg",
    "audio/mp3",
    "audio/wav",
    "audio/wave",
    "audio/x-wav",
    "application/octet-stream",  # fallback para clientes genéricos
}
MAX_FILE_SIZE_MB = 100
MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024


# ---------------------------------------------------------------------------
# Schemas de resposta
# ---------------------------------------------------------------------------

class StemResponse(BaseModel):
    """Representação de um stem separado."""
    stem_name: str
    label: str
    file_path: str


class ProcessBeatResponse(BaseModel):
    """Resposta completa do processamento de um beat."""
    job_id: str
    status: str
    processing_time_seconds: float
    stems: list[StemResponse]


class ErrorResponse(BaseModel):
    """Resposta de erro padronizada."""
    detail: str
    error_code: str


# ---------------------------------------------------------------------------
# Endpoint principal
# ---------------------------------------------------------------------------

@router.post(
    "/process-beat",
    response_model=ProcessBeatResponse,
    status_code=status.HTTP_200_OK,
    summary="Processar Beat — Separação de Stems",
    description=(
        "Recebe um arquivo de áudio (.mp3 ou .wav), executa o modelo "
        "HTDemucs para separar em 4 stems (Vocais, Bateria, Baixo/808, "
        "Melodia) e retorna os caminhos dos arquivos WAV gerados."
    ),
    responses={
        400: {"model": ErrorResponse, "description": "Arquivo inválido"},
        413: {"model": ErrorResponse, "description": "Arquivo muito grande"},
        422: {"model": ErrorResponse, "description": "Áudio muito longo"},
        500: {"model": ErrorResponse, "description": "Erro interno no modelo"},
    },
)
async def process_beat(
    file: UploadFile = File(
        ...,
        description="Arquivo de áudio em formato .mp3 ou .wav (máx. 100 MB)",
    ),
) -> ProcessBeatResponse:
    """
    Pipeline completo:
    1. Validar extensão e content-type do upload
    2. Salvar temporariamente em disco
    3. Invocar o serviço Demucs para separação
    4. Retornar JSON com os stems gerados
    """
    start_time = time.time()

    # ------------------------------------------------------------------
    # 1. Validação do arquivo
    # ------------------------------------------------------------------
    if not file.filename:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Nome do arquivo ausente no upload.",
        )

    extension = Path(file.filename).suffix.lower()
    if extension not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"Formato '{extension}' não suportado. "
                f"Use: {', '.join(ALLOWED_EXTENSIONS)}"
            ),
        )

    if file.content_type and file.content_type not in ALLOWED_CONTENT_TYPES:
        logger.warning(
            "Content-type inesperado '%s' para arquivo '%s'. Prosseguindo.",
            file.content_type,
            file.filename,
        )

    # ------------------------------------------------------------------
    # 2. Salvar arquivo temporário
    # ------------------------------------------------------------------
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    temp_filename = f"{uuid.uuid4().hex[:8]}_{file.filename}"
    temp_path = UPLOAD_DIR / temp_filename

    try:
        content = await file.read()

        # Verificar tamanho
        if len(content) > MAX_FILE_SIZE_BYTES:
            raise HTTPException(
                status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                detail=(
                    f"Arquivo excede o limite de {MAX_FILE_SIZE_MB} MB "
                    f"({len(content) / (1024 * 1024):.1f} MB recebido)."
                ),
            )

        if len(content) == 0:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Arquivo enviado está vazio.",
            )

        temp_path.write_bytes(content)
        logger.info(
            "Upload salvo: %s (%.2f MB)",
            temp_filename,
            len(content) / (1024 * 1024),
        )

    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Erro ao salvar upload: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Erro ao salvar o arquivo enviado.",
        ) from exc

    # ------------------------------------------------------------------
    # 3. Executar separação de stems
    # ------------------------------------------------------------------
    try:
        result: ProcessingResult = await separate_stems(temp_path)

    except ValueError as exc:
        # Erros de validação do áudio (duração, formato interno)
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        ) from exc

    except RuntimeError as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Erro no modelo de IA: {exc}",
        ) from exc

    # ------------------------------------------------------------------
    # 4. Montar resposta
    # ------------------------------------------------------------------
    elapsed = time.time() - start_time
    logger.info(
        "Processamento concluído: job_id=%s em %.1fs",
        result["job_id"],
        elapsed,
    )

    return ProcessBeatResponse(
        job_id=result["job_id"],
        status=result["status"],
        processing_time_seconds=round(elapsed, 2),
        stems=[
            StemResponse(
                stem_name=s["stem_name"],
                label=s["label"],
                file_path=s["file_path"],
            )
            for s in result["stems"]
        ],
    )


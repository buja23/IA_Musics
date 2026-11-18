"""
Trap AI Studio — Rotas de Upload, Processamento, WebSocket e Biblioteca
========================================================================
Endpoints:
  POST   /api/v1/process-beat       → Inicia pipeline assíncrono (HTTP 202)
  WS     /api/v1/ws/{job_id}        → Streaming de progresso em tempo real
  GET    /api/v1/jobs/{job_id}      → Consulta de status/resultado do job (HTTP)
  GET    /api/v1/beats              → Lista biblioteca de beats salvos
  DELETE /api/v1/beats/{job_id}     → Remove beat e stems do disco
  GET    /api/v1/analysis/{job_id}  → Conteúdo completo de analysis.json
"""

from __future__ import annotations

import asyncio
import datetime
import json
import logging
import re
import shutil
import time
from pathlib import Path
from typing import Any

from fastapi import (
    APIRouter,
    HTTPException,
    UploadFile,
    File,
    WebSocket,
    WebSocketDisconnect,
    status,
)
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from services.demucs_service import (
    ProcessingResult,
    UPLOAD_DIR,
    OUTPUT_DIR,
    STEM_NAMES,
    STEM_LABELS,
    separate_stems_sync,
)
from services.music_analyzer import analyze_stems
from services.job_manager import job_manager

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
    "application/octet-stream",
}
MAX_FILE_SIZE_MB = 100
MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024

# Padrão seguro para validar job_id e prevenir path traversal
JOB_ID_REGEX = re.compile(r"^[a-zA-Z0-9_-]{4,32}$")


# ---------------------------------------------------------------------------
# Schemas Pydantic
# ---------------------------------------------------------------------------

class ProcessBeatAsyncResponse(BaseModel):
    """Resposta imediata da criação do job assíncrono."""
    job_id: str
    status: str = "processing"
    message: str = "Processamento iniciado em segundo plano."


class StemResponse(BaseModel):
    """Representação de um stem separado."""
    stem_name: str
    label: str
    file_path: str


class MetadataResponse(BaseModel):
    """Metadados musicais globais extraídos do beat."""
    duration_seconds: float
    bpm: float
    key: str


class MidiFilesResponse(BaseModel):
    """Caminhos dos 3 arquivos MIDI gerados."""
    melody: str
    bass_808: str
    vocals: str


class JobStatusResponse(BaseModel):
    """Status detalhado de um job em processamento ou finalizado."""
    job_id: str
    status: str
    progress: float
    stage: str
    message: str
    result: dict[str, Any] | None = None
    error: str | None = None
    created_at: str
    updated_at: str


class BeatItemResponse(BaseModel):
    """Item da biblioteca de beats salvos."""
    job_id: str
    original_filename: str
    created_at: str
    metadata: MetadataResponse
    stems: list[StemResponse]
    midi_files: MidiFilesResponse
    analysis_url: str


class DeleteBeatResponse(BaseModel):
    """Resposta de confirmação de exclusão."""
    status: str = "deleted"
    job_id: str


class ErrorResponse(BaseModel):
    """Resposta de erro padronizada."""
    detail: str
    error_code: str | None = None


# ---------------------------------------------------------------------------
# Worker assíncrono em background (não bloqueia o Event Loop)
# ---------------------------------------------------------------------------

async def _run_audio_pipeline(
    job_id: str,
    temp_path: Path,
    original_filename: str,
) -> None:
    """
    Executa o pipeline pesado de IA (Demucs + Music Analyzer) em thread separada
    (asyncio.to_thread) e transmite o progresso via WebSocket / JobManager.
    """
    start_time = time.time()
    stems_dir = OUTPUT_DIR / job_id

    def on_progress(prog: float, stage: str, msg: str) -> None:
        job_manager.broadcast_progress(
            job_id=job_id,
            progress=prog,
            stage=stage,
            message=msg,
        )

    try:
        on_progress(10.0, "upload", "Arquivo recebido. Preparando pipeline de IA...")

        # 1. Separação de Stems via Demucs (HTDemucs) na CPU
        logger.info("Disparando Demucs para job_id=%s em thread separada …", job_id)
        demucs_result: ProcessingResult = await asyncio.to_thread(
            separate_stems_sync,
            temp_path,
            job_id,
            on_progress,
        )

        # 2. Análise Musical MIR (BPM, Tom, Transcrição, Bateria, Envelopes 30 FPS)
        logger.info("Disparando análise musical para job_id=%s em thread separada …", job_id)
        on_progress(75.0, "mir_analysis", "Analisando BPM, tonalidade e transientes...")
        analysis = await asyncio.to_thread(
            analyze_stems,
            str(stems_dir),
            job_id,
            on_progress,
        )

        # 3. Montar resultado consolidado
        elapsed = round(time.time() - start_time, 2)
        meta = analysis.get("metadata", {})
        midi_files = analysis.get("midi_files", {})

        result_payload: dict[str, Any] = {
            "job_id": job_id,
            "status": "completed",
            "original_filename": original_filename,
            "processing_time_seconds": elapsed,
            "stems": [
                {
                    "stem_name": s["stem_name"],
                    "label": s["label"],
                    "file_path": s["file_path"],
                }
                for s in demucs_result["stems"]
            ],
            "metadata": {
                "duration_seconds": meta.get("duration_seconds", 0.0),
                "bpm": meta.get("bpm", 0.0),
                "key": meta.get("key", "Unknown"),
            },
            "analysis_url": f"/static/outputs/{job_id}/analysis.json",
            "midi_files": {
                "melody": midi_files.get("melody", f"/static/outputs/{job_id}/midi/melody.mid"),
                "bass_808": midi_files.get("bass_808", f"/static/outputs/{job_id}/midi/bass_808.mid"),
                "vocals": midi_files.get("vocals", f"/static/outputs/{job_id}/midi/vocals.mid"),
            },
        }

        # Atualizar meta.json com resultado consolidado
        meta_json_path = stems_dir / "meta.json"
        if meta_json_path.exists():
            try:
                with open(meta_json_path, "r", encoding="utf-8") as f:
                    meta_disk = json.load(f)
                meta_disk["status"] = "completed"
                meta_disk["processing_time_seconds"] = elapsed
                meta_disk["metadata"] = result_payload["metadata"]
                with open(meta_json_path, "w", encoding="utf-8") as f:
                    json.dump(meta_disk, f, ensure_ascii=False, indent=2)
            except Exception as exc:
                logger.warning("Falha ao atualizar meta.json com status concluído: %s", exc)

        # 4. Transmitir 100% (Concluído)
        job_manager.broadcast_progress(
            job_id=job_id,
            progress=100.0,
            stage="completed",
            message=f"Processamento concluído com sucesso em {elapsed}s!",
            result=result_payload,
        )
        logger.info("Pipeline concluído com sucesso para job_id=%s em %.1fs", job_id, elapsed)

    except Exception as exc:
        logger.exception("Falha no pipeline de áudio para job_id=%s: %s", job_id, exc)
        job_manager.broadcast_progress(
            job_id=job_id,
            progress=0.0,
            stage="failed",
            message=f"Erro durante o processamento: {exc}",
            error=str(exc),
        )
    finally:
        # Garantir limpeza do arquivo temporário de upload
        if temp_path.exists():
            temp_path.unlink(missing_ok=True)


# ---------------------------------------------------------------------------
# POST /api/v1/process-beat (Assíncrono — Retorna HTTP 202)
# ---------------------------------------------------------------------------

@router.post(
    "/process-beat",
    response_model=ProcessBeatAsyncResponse,
    status_code=status.HTTP_202_ACCEPTED,
    summary="Processar Beat (Assíncrono)",
    description=(
        "Recebe o arquivo de áudio, salva os metadados iniciais e agenda o "
        "processamento pesado de IA em segundo plano. Retorna imediatamente "
        "HTTP 202 com o job_id para acompanhamento via WebSocket ou GET."
    ),
    responses={
        400: {"model": ErrorResponse, "description": "Arquivo inválido"},
        413: {"model": ErrorResponse, "description": "Arquivo muito grande"},
        500: {"model": ErrorResponse, "description": "Erro interno ao iniciar processamento"},
    },
)
async def process_beat(
    file: UploadFile = File(
        ...,
        description="Arquivo de áudio em formato .mp3 ou .wav (máx. 100 MB)",
    ),
) -> ProcessBeatAsyncResponse:
    """
    1. Validação de extensão e tamanho
    2. Criação do job_id e diretório static/outputs/{job_id}/
    3. Gravação do meta.json
    4. Agendamento em background via asyncio.create_task
    5. Retorno imediato HTTP 202
    """
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

    # Gerar ID único para o processamento
    import uuid
    job_id = uuid.uuid4().hex[:12]
    job_dir = OUTPUT_DIR / job_id
    job_dir.mkdir(parents=True, exist_ok=True)
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

    temp_path = UPLOAD_DIR / f"{job_id}_{file.filename}"

    try:
        content = await file.read()
        if len(content) > MAX_FILE_SIZE_BYTES:
            if job_dir.exists():
                shutil.rmtree(job_dir, ignore_errors=True)
            raise HTTPException(
                status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                detail=f"Arquivo excede o limite de {MAX_FILE_SIZE_MB} MB.",
            )
        if len(content) == 0:
            if job_dir.exists():
                shutil.rmtree(job_dir, ignore_errors=True)
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Arquivo enviado está vazio.",
            )

        temp_path.write_bytes(content)
        logger.info("Upload gravado: %s (%.2f MB)", temp_path.name, len(content) / (1024 * 1024))

        # Gravar meta.json
        now_iso = datetime.datetime.now(datetime.timezone.utc).isoformat()
        meta_content = {
            "job_id": job_id,
            "original_filename": file.filename,
            "created_at": now_iso,
            "status": "processing",
        }
        with open(job_dir / "meta.json", "w", encoding="utf-8") as f:
            json.dump(meta_content, f, ensure_ascii=False, indent=2)

    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Erro ao salvar upload para job_id=%s: %s", job_id, exc)
        if job_dir.exists():
            shutil.rmtree(job_dir, ignore_errors=True)
        if temp_path.exists():
            temp_path.unlink(missing_ok=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Erro ao salvar arquivo de áudio: {exc}",
        ) from exc

    # Registrar job e disparar pipeline assíncrono em background
    job_manager.create_job(
        job_id=job_id,
        initial_stage="upload",
        initial_progress=10.0,
        initial_message="Arquivo recebido. Preparando pipeline de IA...",
    )

    asyncio.create_task(_run_audio_pipeline(job_id, temp_path, file.filename))

    return ProcessBeatAsyncResponse(
        job_id=job_id,
        status="processing",
        message="Processamento iniciado em segundo plano. Acompanhe via WebSocket ou GET.",
    )


# ---------------------------------------------------------------------------
# WS /api/v1/ws/{job_id} (Streaming de Progresso)
# ---------------------------------------------------------------------------

@router.websocket("/ws/{job_id}")
async def websocket_job_progress(websocket: WebSocket, job_id: str) -> None:
    """
    Streaming WebSocket de progresso em tempo real.
    Transmite atualizações de 0 a 100% para o cliente e envia o estado mais
    recente assim que o cliente conecta.
    """
    if not JOB_ID_REGEX.match(job_id):
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    await job_manager.connect(job_id, websocket)
    try:
        while True:
            # Mantém conexão viva aguardando mensagens/pings do cliente
            await websocket.receive_text()
    except (WebSocketDisconnect, RuntimeError):
        pass
    finally:
        job_manager.disconnect(job_id, websocket)


# ---------------------------------------------------------------------------
# GET /api/v1/jobs/{job_id} (Consulta HTTP de Status)
# ---------------------------------------------------------------------------

@router.get(
    "/jobs/{job_id}",
    response_model=JobStatusResponse,
    summary="Consultar Status do Job (HTTP Fallback)",
    description="Consulta o status, progresso e resultado de um job específico.",
    responses={
        404: {"model": ErrorResponse, "description": "Job não encontrado"},
    },
)
async def get_job_status(job_id: str) -> JobStatusResponse:
    """
    Busca o job em memória no JobManager. Se o servidor tiver reiniciado
    mas os arquivos existirem no disco, reconstrói o estado final a partir do disco.
    """
    if not JOB_ID_REGEX.match(job_id):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="ID de job inválido.")

    job = job_manager.get_job(job_id)
    if job:
        return JobStatusResponse(**job)

    # Fallback para o disco se o job já concluiu e o server reiniciou
    job_dir = OUTPUT_DIR / job_id
    analysis_file = job_dir / "analysis.json"
    meta_file = job_dir / "meta.json"

    if job_dir.is_dir() and analysis_file.is_file():
        try:
            with open(analysis_file, "r", encoding="utf-8") as f:
                analysis = json.load(f)

            orig_filename = f"beat_{job_id}"
            created_at = datetime.datetime.fromtimestamp(
                job_dir.stat().st_mtime, tz=datetime.timezone.utc
            ).isoformat()

            if meta_file.is_file():
                with open(meta_file, "r", encoding="utf-8") as f:
                    meta_disk = json.load(f)
                orig_filename = meta_disk.get("original_filename", orig_filename)
                created_at = meta_disk.get("created_at", created_at)

            meta = analysis.get("metadata", {})
            midi_files = analysis.get("midi_files", {})

            result = {
                "job_id": job_id,
                "status": "completed",
                "original_filename": orig_filename,
                "processing_time_seconds": 0.0,
                "stems": [
                    {
                        "stem_name": name,
                        "label": STEM_LABELS[name],
                        "file_path": f"/static/outputs/{job_id}/{name}.wav",
                    }
                    for name in STEM_NAMES
                ],
                "metadata": {
                    "duration_seconds": meta.get("duration_seconds", 0.0),
                    "bpm": meta.get("bpm", 0.0),
                    "key": meta.get("key", "Unknown"),
                },
                "analysis_url": f"/static/outputs/{job_id}/analysis.json",
                "midi_files": {
                    "melody": midi_files.get("melody", f"/static/outputs/{job_id}/midi/melody.mid"),
                    "bass_808": midi_files.get("bass_808", f"/static/outputs/{job_id}/midi/bass_808.mid"),
                    "vocals": midi_files.get("vocals", f"/static/outputs/{job_id}/midi/vocals.mid"),
                },
            }

            recovered_job = {
                "job_id": job_id,
                "status": "completed",
                "progress": 100.0,
                "stage": "completed",
                "message": "Job recuperado do disco com sucesso.",
                "result": result,
                "error": None,
                "created_at": created_at,
                "updated_at": created_at,
            }
            job_manager.jobs[job_id] = recovered_job
            return JobStatusResponse(**recovered_job)
        except Exception as exc:
            logger.warning("Falha ao recuperar job do disco: %s", exc)

    raise HTTPException(
        status_code=status.HTTP_404_NOT_FOUND,
        detail=f"Job '{job_id}' não encontrado.",
    )


# ---------------------------------------------------------------------------
# GET /api/v1/beats (Biblioteca de Beats Salvos)
# ---------------------------------------------------------------------------

@router.get(
    "/beats",
    response_model=list[BeatItemResponse],
    summary="Listar Biblioteca de Beats Salvos",
    description=(
        "Escaneia static/outputs/ e retorna todos os beats processados que "
        "possuem os 4 stems WAV e analysis.json, ordenados do mais recente para o mais antigo."
    ),
)
async def list_beats() -> list[BeatItemResponse]:
    """
    Escaneia diretórios em static/outputs/ e lê meta.json + analysis.json.
    """
    if not OUTPUT_DIR.exists():
        return []

    beats: list[BeatItemResponse] = []

    for item in OUTPUT_DIR.iterdir():
        if not item.is_dir():
            continue

        job_id = item.name
        if not JOB_ID_REGEX.match(job_id):
            continue

        # Checar se possui os 4 WAVs essenciais
        has_all_wavs = all((item / f"{name}.wav").is_file() for name in STEM_NAMES)
        analysis_file = item / "analysis.json"

        if not (has_all_wavs and analysis_file.is_file()):
            continue

        try:
            with open(analysis_file, "r", encoding="utf-8") as f:
                analysis = json.load(f)

            meta_file = item / "meta.json"
            orig_filename = f"beat_{job_id}"
            created_at = datetime.datetime.fromtimestamp(
                item.stat().st_mtime, tz=datetime.timezone.utc
            ).isoformat()

            if meta_file.is_file():
                try:
                    with open(meta_file, "r", encoding="utf-8") as f:
                        meta_disk = json.load(f)
                    orig_filename = meta_disk.get("original_filename", orig_filename)
                    created_at = meta_disk.get("created_at", created_at)
                except Exception:
                    pass

            meta = analysis.get("metadata", {})
            midi_files = analysis.get("midi_files", {})

            beats.append(
                BeatItemResponse(
                    job_id=job_id,
                    original_filename=orig_filename,
                    created_at=created_at,
                    metadata=MetadataResponse(
                        duration_seconds=float(meta.get("duration_seconds", meta.get("duration", 0.0))),
                        bpm=float(meta.get("bpm", 0.0)),
                        key=str(meta.get("key", "Unknown")),
                    ),
                    stems=[
                        StemResponse(
                            stem_name=name,
                            label=STEM_LABELS[name],
                            file_path=f"/static/outputs/{job_id}/{name}.wav",
                        )
                        for name in STEM_NAMES
                    ],
                    midi_files=MidiFilesResponse(
                        melody=midi_files.get("melody", f"/static/outputs/{job_id}/midi/melody.mid"),
                        bass_808=midi_files.get("bass_808", f"/static/outputs/{job_id}/midi/bass_808.mid"),
                        vocals=midi_files.get("vocals", f"/static/outputs/{job_id}/midi/vocals.mid"),
                    ),
                    analysis_url=f"/static/outputs/{job_id}/analysis.json",
                )
            )
        except Exception as exc:
            logger.warning("Erro ao carregar beat '%s': %s", job_id, exc)

    # Ordenar do mais recente para o mais antigo por created_at
    beats.sort(key=lambda b: b.created_at, reverse=True)
    return beats


# ---------------------------------------------------------------------------
# DELETE /api/v1/beats/{job_id} (Excluir Beat Salvo)
# ---------------------------------------------------------------------------

@router.delete(
    "/beats/{job_id}",
    response_model=DeleteBeatResponse,
    summary="Excluir Beat da Biblioteca",
    description="Remove a pasta do beat e todos os seus stems/arquivos gerados do disco.",
    responses={
        400: {"model": ErrorResponse, "description": "job_id inválido"},
        404: {"model": ErrorResponse, "description": "Beat não encontrado"},
    },
)
async def delete_beat(job_id: str) -> DeleteBeatResponse:
    """
    Validação contra Path Traversal e exclusão física do diretório.
    """
    if not JOB_ID_REGEX.match(job_id):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="ID de job inválido.",
        )

    target_dir = (OUTPUT_DIR / job_id).resolve()
    resolved_outputs = OUTPUT_DIR.resolve()

    # Validação rigorosa de sandbox de pasta
    if target_dir.parent != resolved_outputs or not target_dir.is_dir():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Beat '{job_id}' não encontrado.",
        )

    try:
        shutil.rmtree(target_dir, ignore_errors=True)
        # Remover também do cache em memória se presente
        if job_id in job_manager.jobs:
            del job_manager.jobs[job_id]
        logger.info("Beat excluído com sucesso: %s", job_id)
        return DeleteBeatResponse(status="deleted", job_id=job_id)
    except Exception as exc:
        logger.exception("Erro ao excluir beat %s: %s", job_id, exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Erro ao excluir pasta do beat: {exc}",
        ) from exc


# ---------------------------------------------------------------------------
# GET /api/v1/analysis/{job_id} (Compatibilidade)
# ---------------------------------------------------------------------------

@router.get(
    "/analysis/{job_id}",
    summary="Consultar Análise Musical",
    description="Retorna o conteúdo completo de analysis.json para um processamento previamente concluído.",
    responses={
        200: {"description": "Análise encontrada"},
        404: {"model": ErrorResponse, "description": "Job não encontrado"},
    },
)
async def get_analysis(job_id: str) -> JSONResponse:
    """
    Retorna o JSON da análise direta.
    """
    if not JOB_ID_REGEX.match(job_id):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="ID de job inválido.")

    analysis_path = OUTPUT_DIR / job_id / "analysis.json"

    if not analysis_path.is_file():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Análise não encontrada para job_id '{job_id}'.",
        )

    try:
        with open(analysis_path, "r", encoding="utf-8") as f:
            data = json.load(f)
        return JSONResponse(content=data)
    except Exception as exc:
        logger.exception("Erro ao ler analysis.json: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Erro ao ler arquivo de análise.",
        ) from exc

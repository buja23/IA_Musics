"""
Trap AI Studio — Serviço de Separação de Stems com Demucs (HTDemucs)
====================================================================
Gerencia o ciclo de vida do modelo Demucs: carregamento, inferência e
salvamento dos stems separados (vocals, drums, bass, other).

Design: Singleton do modelo com fallback explícito para CPU.
"""

from __future__ import annotations

import gc
import logging
import shutil
import uuid
from pathlib import Path
from typing import TypedDict, Callable

import numpy as np
import soundfile as sf
import torch

logger = logging.getLogger("trap_ai_studio.demucs_service")

# ---------------------------------------------------------------------------
# Constantes
# ---------------------------------------------------------------------------

# Stems padrão do HTDemucs (ordem retornada pelo modelo)
STEM_NAMES: list[str] = ["drums", "bass", "other", "vocals"]

# Labels amigáveis para o contexto de Trap
STEM_LABELS: dict[str, str] = {
    "drums": "Bateria",
    "bass": "Baixo_808",
    "other": "Melodia",
    "vocals": "Vocais",
}

# Diretórios base (relativos à raiz do projeto)
BASE_DIR = Path(__file__).resolve().parent.parent
UPLOAD_DIR = BASE_DIR / "uploads"
OUTPUT_DIR = BASE_DIR / "static" / "outputs"

# Taxa de amostragem esperada pelo HTDemucs
DEMUCS_SAMPLE_RATE = 44100

# Limite de duração em segundos para evitar OOM na CPU (10 minutos)
MAX_DURATION_SECONDS = 600


# ---------------------------------------------------------------------------
# Tipos de resposta
# ---------------------------------------------------------------------------

class StemResult(TypedDict):
    stem_name: str
    label: str
    file_path: str  # caminho relativo servido como estático


class ProcessingResult(TypedDict):
    job_id: str
    status: str
    stems: list[StemResult]


# ---------------------------------------------------------------------------
# Resolução de dispositivo
# ---------------------------------------------------------------------------

def _resolve_device() -> torch.device:
    """
    Seleciona o melhor dispositivo disponível com fallback seguro para CPU.

    A RX 570 (Polaris/GCN 4) NÃO tem suporte ROCm estável no Windows e
    possui apenas 4 GB de VRAM — insuficiente para o HTDemucs completo.
    Forçamos CPU para garantir estabilidade.
    """
    if torch.cuda.is_available():
        # Em teoria: NVIDIA GPU presente — usar.
        # Na prática neste hardware: nunca será True.
        gpu_mem = torch.cuda.get_device_properties(0).total_mem
        if gpu_mem >= 6 * (1024 ** 3):  # mínimo 6 GB VRAM
            logger.info("GPU CUDA detectada com %.1f GB — usando GPU.", gpu_mem / 1e9)
            return torch.device("cuda")
        logger.warning(
            "GPU CUDA detectada mas com apenas %.1f GB de VRAM. "
            "Usando CPU para evitar OOM.",
            gpu_mem / 1e9,
        )

    logger.info("Nenhuma GPU compatível detectada. Executando Demucs na CPU.")
    return torch.device("cpu")


# ---------------------------------------------------------------------------
# Carregamento do modelo (lazy singleton)
# ---------------------------------------------------------------------------

_model_cache: dict[str, object] = {}


def _load_model(device: torch.device) -> torch.nn.Module:
    """
    Carrega o HTDemucs pré-treinado (htdemucs) uma única vez e mantém
    em cache para requisições subsequentes.
    """
    cache_key = f"htdemucs_{device}"
    if cache_key in _model_cache:
        logger.info("Modelo HTDemucs já carregado — reutilizando cache.")
        return _model_cache[cache_key]  # type: ignore[return-value]

    logger.info("Carregando modelo HTDemucs no dispositivo: %s …", device)

    # Importação tardia para não penalizar o startup do FastAPI
    from demucs.pretrained import get_model  # type: ignore[import-untyped]

    model = get_model("htdemucs")
    model.to(device)
    model.eval()

    _model_cache[cache_key] = model
    logger.info("Modelo HTDemucs carregado com sucesso.")
    return model


# ---------------------------------------------------------------------------
# Pipeline de pré-processamento do áudio
# ---------------------------------------------------------------------------

def _load_and_prepare_audio(
    audio_path: Path,
    device: torch.device,
) -> torch.Tensor:
    """
    Carrega o arquivo de áudio, converte para mono→estéreo se necessário,
    re-amostra para 44.1 kHz e retorna o tensor pronto para o modelo.

    Retorna:
        Tensor de shape (1, channels, samples) — batch de 1.
    """
    # soundfile.read retorna (data: ndarray shape (samples, channels), sample_rate)
    # always_2d=True garante shape (samples, channels) mesmo para mono
    data, sr = sf.read(str(audio_path), dtype="float32", always_2d=True)

    # Transpor para formato PyTorch: (samples, channels) → (channels, samples)
    waveform = torch.from_numpy(data.T.copy())

    # Re-amostrar se a taxa diferir da esperada pelo Demucs
    if sr != DEMUCS_SAMPLE_RATE:
        logger.info("Re-amostrando de %d Hz → %d Hz", sr, DEMUCS_SAMPLE_RATE)
        # Usar interpolação linear para resample sem dependência do torchaudio
        num_samples_target = int(waveform.shape[1] * DEMUCS_SAMPLE_RATE / sr)
        # unsqueeze para (1, channels, samples) → interpolate → squeeze de volta
        waveform = torch.nn.functional.interpolate(
            waveform.unsqueeze(0),
            size=num_samples_target,
            mode="linear",
            align_corners=False,
        ).squeeze(0)

    # Garantir exatamente 2 canais (estéreo) — requisito do HTDemucs
    if waveform.shape[0] == 1:
        # Mono → duplicar canal para estéreo
        waveform = waveform.repeat(2, 1)
    elif waveform.shape[0] > 2:
        # Multicanal → pegar apenas os 2 primeiros
        waveform = waveform[:2, :]

    # Verificar duração para prevenir OOM
    duration_sec = waveform.shape[1] / DEMUCS_SAMPLE_RATE
    if duration_sec > MAX_DURATION_SECONDS:
        raise ValueError(
            f"Áudio muito longo ({duration_sec:.0f}s). "
            f"Máximo permitido: {MAX_DURATION_SECONDS}s."
        )

    # Adicionar dimensão de batch: (channels, samples) → (1, channels, samples)
    waveform = waveform.unsqueeze(0)

    return waveform.to(device)


# ---------------------------------------------------------------------------
# Salvamento dos stems
# ---------------------------------------------------------------------------

def _save_stems(
    stems_tensor: torch.Tensor,
    output_dir: Path,
    job_id: str,
) -> list[StemResult]:
    """
    Salva cada stem separado como arquivo WAV no diretório de saída.

    Args:
        stems_tensor: shape (1, n_sources, channels, samples)
                      — 1 batch, 4 stems, 2 canais, N amostras.
        output_dir: diretório destino.
        job_id: identificador único do processamento.

    Returns:
        Lista de StemResult com caminhos relativos para servir via /static.
    """
    output_dir.mkdir(parents=True, exist_ok=True)
    results: list[StemResult] = []

    # Remover dimensão de batch → (n_sources, channels, samples)
    stems = stems_tensor.squeeze(0)

    for idx, stem_name in enumerate(STEM_NAMES):
        # Extrair stem individual: (channels, samples)
        stem_audio = stems[idx].detach().cpu()

        filename = f"{stem_name}.wav"
        filepath = output_dir / filename

        # Converter tensor (channels, samples) → numpy (samples, channels) para soundfile
        stem_numpy = stem_audio.numpy().T
        # Salvar como WAV 16-bit PCM via soundfile (subtype PCM_16)
        sf.write(
            str(filepath),
            stem_numpy,
            samplerate=DEMUCS_SAMPLE_RATE,
            subtype="PCM_16",
        )

        # Caminho relativo para servir via FastAPI static files
        relative_path = f"/static/outputs/{job_id}/{filename}"

        results.append(
            StemResult(
                stem_name=stem_name,
                label=STEM_LABELS[stem_name],
                file_path=relative_path,
            )
        )
        logger.info("Stem salvo: %s → %s", STEM_LABELS[stem_name], filepath)

    return results


# ---------------------------------------------------------------------------
# Função de execução síncrona (executada em thread de background)
# ---------------------------------------------------------------------------

def separate_stems_sync(
    uploaded_file_path: Path,
    job_id: str | None = None,
    progress_callback: Callable[[float, str, str], None] | None = None,
) -> ProcessingResult:
    """
    Executa o pipeline completo de separação de stems de forma síncrona.
    Permite passar job_id pré-criado e callback de progresso.
    """
    active_job_id = job_id or uuid.uuid4().hex[:12]
    job_output_dir = OUTPUT_DIR / active_job_id

    try:
        # 1. Notificar carregamento do modelo
        if progress_callback:
            progress_callback(20.0, "demucs_load", "Carregando modelo HTDemucs na CPU...")

        device = _resolve_device()
        model = _load_model(device)

        # 2. Carregar e preparar áudio
        logger.info("Pré-processando áudio: %s", uploaded_file_path.name)
        waveform = _load_and_prepare_audio(uploaded_file_path, device)

        # 3. Notificar início da separação
        if progress_callback:
            progress_callback(35.0, "demucs_separate", "Separando stems (Vocais, Bateria, 808, Melodia)...")

        logger.info("Executando separação de stems (device=%s) …", device)
        with torch.no_grad():
            from demucs.apply import apply_model  # type: ignore[import-untyped]

            stems_tensor = apply_model(
                model,
                waveform,
                device=device,
                progress=True,
                num_workers=0,
            )

        if progress_callback:
            progress_callback(60.0, "demucs_separate", "Salvando 4 faixas WAV isoladas...")

        # 4. Salvar stems
        stems = _save_stems(stems_tensor, job_output_dir, active_job_id)

        # Liberar tensores
        del waveform, stems_tensor
        gc.collect()
        if device.type == "cuda":
            torch.cuda.empty_cache()

        return ProcessingResult(
            job_id=active_job_id,
            status="completed",
            stems=stems,
        )

    except ValueError as exc:
        logger.error("Erro de validação: %s", exc)
        if job_output_dir.exists():
            shutil.rmtree(job_output_dir, ignore_errors=True)
        raise

    except Exception as exc:
        logger.exception("Erro durante separação de stems: %s", exc)
        if job_output_dir.exists():
            shutil.rmtree(job_output_dir, ignore_errors=True)
        raise RuntimeError(
            f"Falha no processamento do modelo Demucs: {exc}"
        ) from exc

    finally:
        if uploaded_file_path.exists():
            uploaded_file_path.unlink(missing_ok=True)
            logger.info("Arquivo temporário removido: %s", uploaded_file_path)


async def separate_stems(
    uploaded_file_path: Path,
    job_id: str | None = None,
    progress_callback: Callable[[float, str, str], None] | None = None,
) -> ProcessingResult:
    """
    Wrapper assíncrono para separate_stems_sync (executa em thread dedicada).
    """
    import asyncio
    return await asyncio.to_thread(
        separate_stems_sync, uploaded_file_path, job_id, progress_callback
    )


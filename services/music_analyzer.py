"""
Trap AI Studio — Motor de Análise Musical (MIR)
================================================
Processa os 4 stems gerados pelo Demucs e extrai:
  • Metadados globais (BPM, tonalidade/escala, duração)
  • Transcrição de notas (melodia, 808, vocais) → eventos + MIDI
  • Mapeamento de bateria por banda de frequência (kicks, snares, hihats)
  • Envelopes de energia RMS a 30 FPS (alimenta o Reator Visual 3D)

Dependências: librosa, scipy, pretty_midi, basic-pitch (c/ fallback),
              soundfile, numpy.
"""

from __future__ import annotations

import json
import logging
import warnings
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import Any, Callable

import librosa
import numpy as np
import pretty_midi
import soundfile as sf
from numpy.typing import NDArray
from scipy.signal import butter, sosfilt

logger = logging.getLogger("trap_ai_studio.music_analyzer")

# ---------------------------------------------------------------------------
# Constantes
# ---------------------------------------------------------------------------

# Taxa de amostragem padrão para análise (librosa default)
ANALYSIS_SR = 22050

# Envelopes de energia amostrados a 30 FPS para sincronização visual
ENVELOPE_FPS = 30

# Faixas de frequência para decomposição da bateria (Butterworth)
DRUM_BANDS: dict[str, tuple[float, float]] = {
    "kicks":        (20.0,   150.0),
    "snares_claps": (150.0,  3000.0),
    "hihats":       (3000.0, 16000.0),
}

# Ordem do filtro Butterworth (compromisso: seletividade vs. artefatos)
BUTTER_ORDER = 4

# Nomes de notas e mapeamento para detecção de tonalidade via chroma
# Perfis Krumhansl-Kessler para major e minor
_MAJOR_PROFILE = np.array(
    [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88]
)
_MINOR_PROFILE = np.array(
    [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17]
)
_NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]


# ---------------------------------------------------------------------------
# Dataclasses de resultado
# ---------------------------------------------------------------------------

@dataclass
class NoteEvent:
    """Evento de nota individual transcrito."""
    note_name: str        # ex: "C#3"
    midi: int             # número MIDI (0-127)
    start: float          # início em segundos
    end: float            # fim em segundos
    velocity: float       # 0.0 a 1.0
    pitch_bend: list[float] = field(default_factory=list)  # variações de pitch


@dataclass
class DrumHit:
    """Ataque de bateria detectado em uma banda de frequência."""
    time: float           # posição em segundos
    intensity: float      # 0.0 a 1.0


@dataclass
class AnalysisResult:
    """Resultado completo da análise musical."""
    metadata: dict[str, Any]
    transcription: dict[str, list[dict]]
    midi_files: dict[str, str]
    drum_mapping: dict[str, list[dict]]
    energy_envelopes: dict[str, list[float]]


# ===========================================================================
# Utilitários de I/O e DSP
# ===========================================================================

def _load_stem_mono(stem_path: Path, sr: int = ANALYSIS_SR) -> NDArray[np.float32]:
    """Carrega um stem WAV como array mono float32 re-amostrado."""
    data, orig_sr = sf.read(str(stem_path), dtype="float32", always_2d=True)
    # Mixar para mono: média dos canais → (samples,)
    mono = data.mean(axis=1)
    # Re-amostrar se necessário
    if orig_sr != sr:
        mono = librosa.resample(mono, orig_sr=orig_sr, target_sr=sr)
    return mono


def _bandpass_filter(
    signal: NDArray[np.float32],
    low: float,
    high: float,
    sr: int,
    order: int = BUTTER_ORDER,
) -> NDArray[np.float32]:
    """Aplica filtro Butterworth passa-banda ao sinal."""
    nyquist = sr / 2.0
    # Clipar frequências ao intervalo válido (0, Nyquist)
    low_norm = max(low / nyquist, 1e-5)
    high_norm = min(high / nyquist, 0.9999)
    sos = butter(order, [low_norm, high_norm], btype="bandpass", output="sos")
    return sosfilt(sos, signal).astype(np.float32)


def _midi_note_to_name(midi_note: int) -> str:
    """Converte número MIDI para nome legível (ex: 60 → 'C4')."""
    octave = (midi_note // 12) - 1
    note = _NOTE_NAMES[midi_note % 12]
    return f"{note}{octave}"


# ===========================================================================
# 1. Metadados Globais (BPM, Tonalidade, Duração)
# ===========================================================================

def _estimate_bpm(drums_mono: NDArray[np.float32], sr: int) -> float:
    """
    Estima o BPM usando o stem de bateria (mais confiável para trap).
    librosa.beat.beat_track retorna (tempo, beat_frames).
    """
    tempo, _ = librosa.beat.beat_track(y=drums_mono, sr=sr)
    # tempo pode ser ndarray em versões recentes do librosa
    bpm = float(np.atleast_1d(tempo)[0])
    logger.info("BPM estimado: %.1f", bpm)
    return round(bpm, 1)


def _estimate_key(
    melody_mono: NDArray[np.float32],
    sr: int,
) -> str:
    """
    Estima tonalidade/escala usando perfil cromático (chroma_cqt) e
    correlação com perfis Krumhansl-Kessler para major e minor.

    Retorna string como "F# minor" ou "C major".
    """
    # Extrair cromagrama CQT — shape (12, frames)
    chroma = librosa.feature.chroma_cqt(y=melody_mono, sr=sr)
    # Perfil médio: energia média de cada classe de pitch → vetor (12,)
    chroma_mean = chroma.mean(axis=1)

    best_score = -np.inf
    best_key = "C major"

    for shift in range(12):
        # Rotacionar perfis para cada tonalidade candidata
        major_corr = float(np.corrcoef(
            np.roll(_MAJOR_PROFILE, shift), chroma_mean
        )[0, 1])
        minor_corr = float(np.corrcoef(
            np.roll(_MINOR_PROFILE, shift), chroma_mean
        )[0, 1])

        if major_corr > best_score:
            best_score = major_corr
            best_key = f"{_NOTE_NAMES[shift]} major"
        if minor_corr > best_score:
            best_score = minor_corr
            best_key = f"{_NOTE_NAMES[shift]} minor"

    logger.info("Tonalidade estimada: %s (correlação=%.3f)", best_key, best_score)
    return best_key


# ===========================================================================
# 2. Transcrição de Notas (basic-pitch com fallback librosa.pyin)
# ===========================================================================

def _transcribe_with_basic_pitch(
    audio_path: Path,
) -> list[NoteEvent]:
    """
    Transcrição polifônica via basic-pitch.
    Retorna lista de NoteEvent com pitch_bend vazio (basic-pitch não gera).
    """
    from basic_pitch.inference import predict as bp_predict  # type: ignore[import-untyped]

    # basic-pitch retorna (model_output, midi_data, note_events)
    # note_events: list de (start, end, midi_note, velocity, pitch_bend_list)
    _, midi_data, note_events = bp_predict(str(audio_path))

    events: list[NoteEvent] = []
    for start, end, midi_note, vel, bends in note_events:
        events.append(NoteEvent(
            note_name=_midi_note_to_name(int(midi_note)),
            midi=int(midi_note),
            start=round(float(start), 4),
            end=round(float(end), 4),
            velocity=round(float(np.clip(vel, 0.0, 1.0)), 3),
            pitch_bend=[round(float(b), 3) for b in (bends or [])],
        ))
    return events


def _transcribe_with_pyin(
    mono: NDArray[np.float32],
    sr: int,
) -> list[NoteEvent]:
    """
    Fallback monofônico via librosa.pyin para ambientes onde
    basic-pitch/TensorFlow não carrega.

    Detecta F0 frame a frame, agrupa em notas contíguas e estima
    pitch_bend como variação intra-nota.
    """
    # pyin retorna (f0, voiced_flag, voiced_probs) — arrays de frames
    f0, voiced, _ = librosa.pyin(
        mono, fmin=librosa.note_to_hz("C1"), fmax=librosa.note_to_hz("C7"), sr=sr
    )

    hop = 512  # hop padrão do librosa
    frame_dur = hop / sr
    events: list[NoteEvent] = []

    # Agrupar frames voiced contíguos em notas
    i = 0
    n_frames = len(f0)
    while i < n_frames:
        if not voiced[i] or np.isnan(f0[i]):
            i += 1
            continue

        # Início de uma nota
        start_frame = i
        freqs: list[float] = []
        while i < n_frames and voiced[i] and not np.isnan(f0[i]):
            freqs.append(float(f0[i]))
            i += 1

        end_frame = i
        if not freqs:
            continue

        # Frequência mediana → nota MIDI
        median_freq = float(np.median(freqs))
        midi_note = int(round(librosa.hz_to_midi(median_freq)))
        midi_note = int(np.clip(midi_note, 0, 127))

        # Pitch bend: desvio de cada frame em relação à nota quantizada (em semitons)
        ref_freq = librosa.midi_to_hz(midi_note)
        bends = [
            round(float(12.0 * np.log2(f / ref_freq)), 3)
            for f in freqs
        ]

        # Velocity proporcional à energia RMS do segmento
        seg_start = start_frame * hop
        seg_end = min(end_frame * hop, len(mono))
        segment = mono[seg_start:seg_end]
        rms = float(np.sqrt(np.mean(segment ** 2))) if len(segment) > 0 else 0.0
        velocity = float(np.clip(rms * 5.0, 0.0, 1.0))  # escalar para ~[0,1]

        events.append(NoteEvent(
            note_name=_midi_note_to_name(midi_note),
            midi=midi_note,
            start=round(start_frame * frame_dur, 4),
            end=round(end_frame * frame_dur, 4),
            velocity=round(velocity, 3),
            pitch_bend=bends,
        ))

    return events


def _transcribe_stem(
    stem_path: Path,
    mono: NDArray[np.float32],
    sr: int,
    stem_label: str,
) -> list[NoteEvent]:
    """
    Tenta transcrever com basic-pitch; em caso de falha (TF não disponível,
    erro de DLL, etc.), recorre ao fallback librosa.pyin.
    """
    try:
        logger.info("Transcrevendo %s com basic-pitch …", stem_label)
        events = _transcribe_with_basic_pitch(stem_path)
        logger.info(
            "basic-pitch: %d notas detectadas em %s.", len(events), stem_label
        )
        return events
    except Exception as exc:
        logger.warning(
            "basic-pitch falhou para %s (%s). Usando fallback librosa.pyin.",
            stem_label, exc,
        )
        events = _transcribe_with_pyin(mono, sr)
        logger.info(
            "librosa.pyin (fallback): %d notas detectadas em %s.",
            len(events), stem_label,
        )
        return events


# ===========================================================================
# 3. Exportação MIDI
# ===========================================================================

def _events_to_midi(
    events: list[NoteEvent],
    output_path: Path,
    instrument_program: int = 0,
    instrument_name: str = "Piano",
) -> None:
    """
    Converte lista de NoteEvent em arquivo MIDI via pretty_midi.
    Inclui pitch bend por nota quando disponível.
    """
    pm = pretty_midi.PrettyMIDI(initial_tempo=120.0)
    inst = pretty_midi.Instrument(
        program=instrument_program, name=instrument_name
    )

    for ev in events:
        note = pretty_midi.Note(
            velocity=int(np.clip(ev.velocity * 127, 1, 127)),
            pitch=int(np.clip(ev.midi, 0, 127)),
            start=ev.start,
            end=max(ev.end, ev.start + 0.01),  # duração mínima 10ms
        )
        inst.notes.append(note)

        # Adicionar pitch bend se presente (converter semitons → unidades MIDI)
        if ev.pitch_bend:
            note_dur = ev.end - ev.start
            n_bends = len(ev.pitch_bend)
            for idx, bend_st in enumerate(ev.pitch_bend):
                t = ev.start + (idx / max(n_bends - 1, 1)) * note_dur
                # MIDI pitch bend: ±8192 = ±2 semitons → 4096 por semitom
                bend_val = int(np.clip(bend_st * 4096, -8192, 8191))
                inst.pitch_bends.append(
                    pretty_midi.PitchBend(pitch=bend_val, time=t)
                )

    pm.instruments.append(inst)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    pm.write(str(output_path))
    logger.info("MIDI exportado: %s (%d notas)", output_path.name, len(events))


# ===========================================================================
# 4. Mapeamento de Bateria (kicks, snares, hihats)
# ===========================================================================

def _analyze_drums(
    drums_mono: NDArray[np.float32],
    sr: int,
) -> dict[str, list[DrumHit]]:
    """
    Separa o stem de bateria em 3 bandas via Butterworth e detecta
    onsets (ataques) em cada banda.
    """
    result: dict[str, list[DrumHit]] = {}

    for band_name, (low, high) in DRUM_BANDS.items():
        # Filtrar banda de frequência
        filtered = _bandpass_filter(drums_mono, low, high, sr)

        # Detectar onsets (ataques)
        onset_env = librosa.onset.onset_strength(y=filtered, sr=sr)
        onset_frames = librosa.onset.onset_detect(
            y=filtered, sr=sr, onset_envelope=onset_env, backtrack=False
        )
        onset_times = librosa.frames_to_time(onset_frames, sr=sr)

        # Normalizar intensidades usando o envelope de onset
        if len(onset_env) > 0:
            max_env = onset_env.max()
            if max_env > 0:
                onset_env_norm = onset_env / max_env
            else:
                onset_env_norm = onset_env
        else:
            onset_env_norm = onset_env

        hits: list[DrumHit] = []
        for frame_idx, t in zip(onset_frames, onset_times):
            intensity = float(onset_env_norm[frame_idx]) if frame_idx < len(onset_env_norm) else 0.5
            hits.append(DrumHit(
                time=round(float(t), 4),
                intensity=round(float(np.clip(intensity, 0.0, 1.0)), 3),
            ))

        result[band_name] = hits
        logger.info(
            "Bateria [%s] (%d–%d Hz): %d ataques detectados.",
            band_name, int(low), int(high), len(hits),
        )

    return result


# ===========================================================================
# 5. Envelopes de Energia RMS (30 FPS)
# ===========================================================================

def _compute_energy_envelope(
    mono: NDArray[np.float32],
    sr: int,
    fps: int = ENVELOPE_FPS,
) -> list[float]:
    """
    Calcula curva de energia RMS normalizada (0.0–1.0) amostrada
    exatamente a `fps` frames por segundo.

    O hop_length é calculado como sr/fps para garantir 1 frame por
    intervalo visual (ex: sr=22050, fps=30 → hop=735 → ~30.0 FPS).
    """
    hop_length = sr // fps  # 22050 // 30 = 735
    # frame_length = 2 * hop para suavizar o envelope
    frame_length = hop_length * 2

    # librosa.feature.rms retorna shape (1, n_frames)
    rms = librosa.feature.rms(
        y=mono, frame_length=frame_length, hop_length=hop_length
    )[0]

    # Normalizar para [0.0, 1.0]
    rms_max = rms.max()
    if rms_max > 0:
        rms_norm = rms / rms_max
    else:
        rms_norm = rms

    return [round(float(v), 4) for v in rms_norm]


# ===========================================================================
# Função principal — ponto de entrada público
# ===========================================================================

def analyze_stems(
    stems_dir: str,
    job_id: str,
    progress_callback: Callable[[float, str, str], None] | None = None,
) -> dict[str, Any]:
    """
    Pipeline completo de análise musical sobre os 4 stems do Demucs.

    Args:
        stems_dir: caminho absoluto do diretório contendo os 4 WAVs.
        job_id: identificador único do processamento.
        progress_callback: callback opcional (progresso, stage, mensagem).

    Returns:
        Dicionário com metadados, transcrição, drum_mapping,
        energy_envelopes e caminhos dos MIDIs gerados.
    """
    stems_path = Path(stems_dir)
    midi_dir = stems_path / "midi"
    midi_dir.mkdir(parents=True, exist_ok=True)

    # Suprimir warnings do librosa/numba que poluem o log
    warnings.filterwarnings("ignore", category=FutureWarning)
    warnings.filterwarnings("ignore", category=UserWarning, module="librosa")

    # ------------------------------------------------------------------
    # Carregar os 4 stems em mono
    # ------------------------------------------------------------------
    logger.info("Carregando stems para análise (job_id=%s) …", job_id)
    if progress_callback:
        progress_callback(72.0, "mir_analysis", "Carregando stems para análise espectral...")

    drums_mono = _load_stem_mono(stems_path / "drums.wav")
    bass_mono = _load_stem_mono(stems_path / "bass.wav")
    other_mono = _load_stem_mono(stems_path / "other.wav")
    vocals_mono = _load_stem_mono(stems_path / "vocals.wav")

    # Duração total (usar qualquer stem — todos têm o mesmo comprimento)
    duration = round(float(len(drums_mono)) / ANALYSIS_SR, 2)
    logger.info("Duração total: %.2fs", duration)

    # ------------------------------------------------------------------
    # 1. Metadados Globais
    # ------------------------------------------------------------------
    logger.info("Estimando BPM e tonalidade …")
    if progress_callback:
        progress_callback(78.0, "mir_analysis", "Analisando BPM, tonalidade e transientes...")

    bpm = _estimate_bpm(drums_mono, ANALYSIS_SR)
    key = _estimate_key(other_mono, ANALYSIS_SR)

    metadata = {
        "duration_seconds": duration,
        "duration": duration,
        "bpm": bpm,
        "key": key,
    }

    # ------------------------------------------------------------------
    # 2. Transcrição de Notas + Exportação MIDI
    # ------------------------------------------------------------------
    logger.info("Iniciando transcrição de notas …")
    if progress_callback:
        progress_callback(85.0, "midi_export", "Transcrevendo notas e gerando arquivos MIDI...")

    # Melodia (other.wav)
    melody_events = _transcribe_stem(
        stems_path / "other.wav", other_mono, ANALYSIS_SR, "Melodia"
    )
    melody_midi_path = midi_dir / "melody.mid"
    _events_to_midi(
        melody_events, melody_midi_path,
        instrument_program=0, instrument_name="Melody",
    )

    # Baixo / 808 (bass.wav)
    bass_events = _transcribe_stem(
        stems_path / "bass.wav", bass_mono, ANALYSIS_SR, "Baixo_808"
    )
    bass_midi_path = midi_dir / "bass_808.mid"
    _events_to_midi(
        bass_events, bass_midi_path,
        instrument_program=33, instrument_name="Bass 808",  # GM: Electric Bass
    )

    # Vocais (vocals.wav)
    vocals_events = _transcribe_stem(
        stems_path / "vocals.wav", vocals_mono, ANALYSIS_SR, "Vocais"
    )
    vocals_midi_path = midi_dir / "vocals.mid"
    _events_to_midi(
        vocals_events, vocals_midi_path,
        instrument_program=54, instrument_name="Vocals",  # GM: Synth Voice
    )

    transcription = {
        "melody": [asdict(e) for e in melody_events],
        "bass_808": [asdict(e) for e in bass_events],
        "vocals": [asdict(e) for e in vocals_events],
    }

    midi_files = {
        "melody": f"/static/outputs/{job_id}/midi/melody.mid",
        "bass_808": f"/static/outputs/{job_id}/midi/bass_808.mid",
        "vocals": f"/static/outputs/{job_id}/midi/vocals.mid",
    }

    # ------------------------------------------------------------------
    # 3. Mapeamento de Bateria
    # ------------------------------------------------------------------
    logger.info("Analisando bateria por banda de frequência …")
    drum_hits = _analyze_drums(drums_mono, ANALYSIS_SR)
    drum_mapping = {
        band: [asdict(h) for h in hits]
        for band, hits in drum_hits.items()
    }

    # ------------------------------------------------------------------
    # 4. Envelopes de Energia (30 FPS)
    # ------------------------------------------------------------------
    logger.info("Calculando envelopes de energia a %d FPS …", ENVELOPE_FPS)
    energy_envelopes = {
        "vocals": _compute_energy_envelope(vocals_mono, ANALYSIS_SR),
        "drums":  _compute_energy_envelope(drums_mono, ANALYSIS_SR),
        "bass":   _compute_energy_envelope(bass_mono, ANALYSIS_SR),
        "other":  _compute_energy_envelope(other_mono, ANALYSIS_SR),
    }
    logger.info(
        "Envelopes gerados: %d frames/stem (~%.1fs a %d FPS).",
        len(energy_envelopes["drums"]),
        len(energy_envelopes["drums"]) / ENVELOPE_FPS,
        ENVELOPE_FPS,
    )

    # ------------------------------------------------------------------
    # Montar resultado final (com suporte aos nomes da FASE 2 e FASE 3)
    # ------------------------------------------------------------------
    result: dict[str, Any] = {
        "job_id": job_id,
        "metadata": metadata,
        "transcription": transcription,
        "notes": transcription,
        "midi_files": midi_files,
        "drum_mapping": drum_mapping,
        "drums": drum_mapping,
        "energy_envelopes": energy_envelopes,
        "envelopes_30fps": energy_envelopes,
    }

    # Salvar analysis.json
    analysis_json_path = stems_path / "analysis.json"
    with open(analysis_json_path, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)
    logger.info("Análise salva: %s", analysis_json_path)

    return result

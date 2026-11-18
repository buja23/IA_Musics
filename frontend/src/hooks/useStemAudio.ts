import { useState, useEffect, useRef, useCallback, MutableRefObject } from 'react';
import { StemType, StemChannelState } from '../types';

interface UseStemAudioProps {
  stems: Record<StemType, string> | null;
  duration?: number;
}

const DEFAULT_CHANNEL_STATE: StemChannelState = {
  muted: false,
  solo: false,
  volume: 0.85,
};

export function useStemAudio({ stems, duration = 0 }: UseStemAudioProps): {
  isPlaying: boolean;
  currentTime: number;
  channels: Record<StemType, StemChannelState>;
  isLoop: boolean;
  masterVolume: number;
  setIsLoop: (value: boolean) => void;
  setMasterVolume: (value: number) => void;
  togglePlay: () => void;
  play: () => Promise<void>;
  pause: () => void;
  seek: (time: number) => void;
  toggleMute: (stem: StemType) => void;
  toggleSolo: (stem: StemType) => void;
  setVolume: (stem: StemType, volume: number) => void;
  getAudioStream: () => Promise<MediaStream | null>;
  effectiveGainsRef: MutableRefObject<Record<StemType, number>>;
  getFrequencyData: () => Uint8Array;
} {
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [isLoop, setIsLoop] = useState<boolean>(false);
  const [masterVolume, setMasterVolume] = useState<number>(0.9);

  const [channels, setChannels] = useState<Record<StemType, StemChannelState>>({
    drums: { ...DEFAULT_CHANNEL_STATE },
    bass: { ...DEFAULT_CHANNEL_STATE },
    other: { ...DEFAULT_CHANNEL_STATE },
    vocals: { ...DEFAULT_CHANNEL_STATE },
  });

  const audioRefs = useRef<Record<StemType, HTMLAudioElement | null>>({
    drums: null,
    bass: null,
    other: null,
    vocals: null,
  });

  // Web Audio API Nodes para mixagem e gravação de vídeo
  const audioCtxRef = useRef<AudioContext | null>(null);
  const masterGainRef = useRef<GainNode | null>(null);
  const mediaStreamDestRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const frequencyDataRef = useRef<Uint8Array>(new Uint8Array(128));
  const effectiveGainsRef = useRef<Record<StemType, number>>({
    drums: 0.85,
    bass: 0.85,
    other: 0.85,
    vocals: 0.85,
  });
  const gainNodesRef = useRef<Record<StemType, GainNode | null>>({
    drums: null,
    bass: null,
    other: null,
    vocals: null,
  });
  const sourceNodesRef = useRef<Record<StemType, MediaElementAudioSourceNode | null>>({
    drums: null,
    bass: null,
    other: null,
    vocals: null,
  });

  const rafRef = useRef<number | null>(null);
  const isSeekingRef = useRef<boolean>(false);

  // Inicializa o grafo do Web Audio API de forma segura
  const initWebAudio = useCallback(() => {
    if (audioCtxRef.current) {
      if (audioCtxRef.current.state === 'suspended') {
        audioCtxRef.current.resume();
      }
      return;
    }

    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextClass) return;

    const ctx = new AudioContextClass();
    audioCtxRef.current = ctx;

    const masterGain = ctx.createGain();
    masterGain.gain.setValueAtTime(masterVolume, ctx.currentTime);
    masterGainRef.current = masterGain;

    // Destino para captura de stream de áudio (para gravação de vídeo no MediaRecorder)
    const streamDest = ctx.createMediaStreamDestination();
    mediaStreamDestRef.current = streamDest;

    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.8;
    analyserRef.current = analyser;
    frequencyDataRef.current = new Uint8Array(analyser.frequencyBinCount);

    // O analisador fica depois do masterGain e antes dos destinos de saída/gravação.
    masterGain.connect(analyser);
    analyser.connect(ctx.destination);
    analyser.connect(streamDest);

    // Conectar fontes de áudio aos ganhos individuais
    const stemKeys: StemType[] = ['drums', 'bass', 'other', 'vocals'];
    stemKeys.forEach((key) => {
      const audioEl = audioRefs.current[key];
      if (audioEl && !sourceNodesRef.current[key]) {
        try {
          const sourceNode = ctx.createMediaElementSource(audioEl);
          const gainNode = ctx.createGain();
          gainNode.gain.setValueAtTime(0.85, ctx.currentTime);

          sourceNode.connect(gainNode);
          gainNode.connect(masterGain);

          sourceNodesRef.current[key] = sourceNode;
          gainNodesRef.current[key] = gainNode;
        } catch (err) {
          console.warn(`Erro ao conectar nó Web Audio para ${key}:`, err);
        }
      }
    });
  }, [masterVolume]);

  // Inicializa ou atualiza os elementos <audio> quando a lista de stems muda
  useEffect(() => {
    if (!stems) {
      // Limpar áudios anteriores
      Object.values(audioRefs.current).forEach((audio) => {
        if (audio) {
          audio.pause();
          audio.src = '';
        }
      });
      audioRefs.current = { drums: null, bass: null, other: null, vocals: null };
      sourceNodesRef.current = { drums: null, bass: null, other: null, vocals: null };
      gainNodesRef.current = { drums: null, bass: null, other: null, vocals: null };
      setIsPlaying(false);
      setCurrentTime(0);
      return;
    }

    const stemKeys: StemType[] = ['drums', 'bass', 'other', 'vocals'];

    stemKeys.forEach((key) => {
      const url = stems[key];
      if (url) {
        const audio = new Audio(url);
        audio.preload = 'auto';
        audio.crossOrigin = 'anonymous';
        audioRefs.current[key] = audio;
      }
    });

    return () => {
      stemKeys.forEach((key) => {
        const audio = audioRefs.current[key];
        if (audio) {
          audio.pause();
          audio.src = '';
        }
      });
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, [stems]);

  // Atualiza os volumes reais nos nós Web Audio de acordo com Mute e Solo
  useEffect(() => {
    const hasSolo = Object.values(channels).some((c) => c.solo);
    const ctx = audioCtxRef.current;
    const now = ctx ? ctx.currentTime : 0;

    if (masterGainRef.current && ctx) {
      masterGainRef.current.gain.setValueAtTime(masterVolume, now);
    }

    (Object.keys(channels) as StemType[]).forEach((key) => {
      const audio = audioRefs.current[key];
      const gainNode = gainNodesRef.current[key];
      const ch = channels[key];

      let effectiveGain = 0;
      if (hasSolo) {
        effectiveGain = ch.solo && !ch.muted ? ch.volume : 0;
      } else {
        effectiveGain = ch.muted ? 0 : ch.volume;
      }
      effectiveGainsRef.current[key] = effectiveGain;

      // Aplica no elemento de áudio como fallback
      if (audio) {
        audio.volume = effectiveGain;
      }

      // Aplica no nó de ganho do Web Audio para alimentar a mixagem e gravação de vídeo
      if (gainNode && ctx) {
        gainNode.gain.setValueAtTime(effectiveGain, now);
      }
    });
  }, [channels, masterVolume]);

  // Loop de sincronização de currentTime via requestAnimationFrame
  const updateLoop = useCallback(() => {
    const masterAudio =
      audioRefs.current.drums ||
      audioRefs.current.bass ||
      audioRefs.current.other ||
      audioRefs.current.vocals;

    if (masterAudio && !isSeekingRef.current) {
      const t = masterAudio.currentTime;
      setCurrentTime(t);

      // Sincroniza sutilmente os outros se houver drift > 0.05s
      (Object.keys(audioRefs.current) as StemType[]).forEach((key) => {
        const a = audioRefs.current[key];
        if (a && a !== masterAudio && Math.abs(a.currentTime - t) > 0.05) {
          a.currentTime = t;
        }
      });

      // Detecta fim da música
      const effectiveDuration = duration || masterAudio.duration || 0;
      if (effectiveDuration > 0 && t >= effectiveDuration) {
        if (isLoop) {
          seek(0);
          play();
        } else {
          pause();
          seek(0);
        }
        return;
      }
    }

    rafRef.current = requestAnimationFrame(updateLoop);
  }, [duration, isLoop]);

  const play = useCallback(async () => {
    initWebAudio();
    const audios = Object.values(audioRefs.current).filter(Boolean) as HTMLAudioElement[];
    if (audios.length === 0) return;

    try {
      await Promise.all(audios.map((a) => a.play()));
      setIsPlaying(true);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(updateLoop);
    } catch (err) {
      console.warn('Erro ao iniciar reprodução:', err);
    }
  }, [initWebAudio, updateLoop]);

  const pause = useCallback(() => {
    const audios = Object.values(audioRefs.current).filter(Boolean) as HTMLAudioElement[];
    audios.forEach((a) => a.pause());
    setIsPlaying(false);
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  const togglePlay = useCallback(() => {
    if (isPlaying) {
      pause();
    } else {
      play();
    }
  }, [isPlaying, pause, play]);

  const seek = useCallback((targetTime: number) => {
    isSeekingRef.current = true;
    const audios = Object.values(audioRefs.current).filter(Boolean) as HTMLAudioElement[];
    audios.forEach((a) => {
      a.currentTime = targetTime;
    });
    setCurrentTime(targetTime);
    setTimeout(() => {
      isSeekingRef.current = false;
    }, 50);
  }, []);

  const toggleMute = useCallback((stem: StemType) => {
    setChannels((prev) => ({
      ...prev,
      [stem]: { ...prev[stem], muted: !prev[stem].muted },
    }));
  }, []);

  const toggleSolo = useCallback((stem: StemType) => {
    setChannels((prev) => ({
      ...prev,
      [stem]: { ...prev[stem], solo: !prev[stem].solo },
    }));
  }, []);

  const setVolume = useCallback((stem: StemType, volume: number) => {
    setChannels((prev) => ({
      ...prev,
      [stem]: { ...prev[stem], volume: Math.max(0, Math.min(1, volume)) },
    }));
  }, []);

  useEffect(() => {
    const stemKeys: StemType[] = ['drums', 'bass', 'other', 'vocals'];
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.matches('input, textarea, select, [contenteditable="true"]')) return;

      if (event.code === 'Space') {
        event.preventDefault();
        togglePlay();
        return;
      }

      const shortcutIndex = ['1', '2', '3', '4'].indexOf(event.key);
      if (shortcutIndex >= 0) {
        event.preventDefault();
        const stem = stemKeys[shortcutIndex];
        if (event.shiftKey) toggleSolo(stem);
        else toggleMute(stem);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [togglePlay, toggleMute, toggleSolo]);

  const getFrequencyData = useCallback((): Uint8Array => {
    if (analyserRef.current) {
      analyserRef.current.getByteFrequencyData(frequencyDataRef.current as unknown as Uint8Array<ArrayBuffer>);
    }
    return frequencyDataRef.current;
  }, []);

  // Retorna a faixa de áudio mixada em tempo real para o MediaRecorder garantindo AudioContext ativo
  const getAudioStream = useCallback(async (): Promise<MediaStream | null> => {
    initWebAudio();
    if (audioCtxRef.current && audioCtxRef.current.state === 'suspended') {
      try {
        await audioCtxRef.current.resume();
      } catch (e) {
        console.warn('Erro ao resumir AudioContext:', e);
      }
    }
    return mediaStreamDestRef.current?.stream ?? null;
  }, [initWebAudio]);

  return {
    isPlaying,
    currentTime,
    channels,
    isLoop,
    masterVolume,
    setIsLoop,
    setMasterVolume,
    togglePlay,
    play,
    pause,
    seek,
    toggleMute,
    toggleSolo,
    setVolume,
    getAudioStream,
    effectiveGainsRef,
    getFrequencyData,
  };
}

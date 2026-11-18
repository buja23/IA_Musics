import React, { useState, useRef, DragEvent, ChangeEvent } from 'react';
import { Upload, Music, Disc, Sparkles, AlertCircle, Loader2, Activity } from 'lucide-react';
import { ProcessBeatResponse } from '../types';

interface UploadAreaProps {
  onProcessComplete: (data: ProcessBeatResponse) => void;
}

const BACKEND_URL = 'http://localhost:8000';
const WS_URL = 'ws://localhost:8000';

export const UploadArea: React.FC<UploadAreaProps> = ({ onProcessComplete }) => {
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progressPercent, setProgressPercent] = useState<number>(10);
  const [progressStage, setProgressStage] = useState<string>('upload');
  const [progressMessage, setProgressMessage] = useState<string>(
    'Preparando arquivo para processamento...'
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      processFile(e.dataTransfer.files[0]);
    }
  };

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      processFile(e.target.files[0]);
    }
  };

  const processFile = async (file: File) => {
    const ext = file.name.split('.').pop()?.toLowerCase();
    if (ext !== 'mp3' && ext !== 'wav') {
      setErrorMessage('Por favor selecione um arquivo válido (.mp3 ou .wav).');
      return;
    }

    setErrorMessage(null);
    setSelectedFileName(file.name);
    setIsProcessing(true);
    setProgressPercent(10);
    setProgressStage('upload');
    setProgressMessage('Enviando arquivo e registrando job...');

    try {
      const formData = new FormData();
      formData.append('file', file);

      // Inicia job assíncrono (HTTP 202)
      const response = await fetch(`${BACKEND_URL}/api/v1/process-beat`, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(
          errorData.detail || `Erro no servidor (Status: ${response.status})`
        );
      }

      const initData = await response.json();
      const jobId = initData.job_id;

      // Conectar WebSocket para streaming de progresso em tempo real
      connectWebSocket(jobId);
    } catch (err: any) {
      setIsProcessing(false);
      setErrorMessage(
        err.message || 'Falha ao processar o áudio. Verifique se o backend está rodando na porta 8000.'
      );
    }
  };

  const connectWebSocket = (jobId: string) => {
    const ws = new WebSocket(`${WS_URL}/api/v1/ws/${jobId}`);
    wsRef.current = ws;

    ws.onopen = () => {
      console.log(`[WS] Conectado ao streaming do job ${jobId}`);
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.progress !== undefined) {
          setProgressPercent(data.progress);
        }
        if (data.stage) {
          setProgressStage(data.stage);
        }
        if (data.message) {
          setProgressMessage(data.message);
        }

        if (data.status === 'completed' && data.result) {
          ws.close();
          onProcessComplete(data.result as ProcessBeatResponse);
        } else if (data.status === 'failed') {
          ws.close();
          setIsProcessing(false);
          setErrorMessage(data.error || data.message || 'Falha no processamento.');
        }
      } catch (err) {
        console.warn('[WS] Erro ao processar mensagem:', err);
      }
    };

    ws.onerror = (err) => {
      console.warn('[WS] Erro de conexão, iniciando polling de fallback...', err);
      startPolling(jobId);
    };

    ws.onclose = () => {
      console.log(`[WS] Conexão encerrada para o job ${jobId}`);
    };
  };

  // Fallback via HTTP Polling caso WebSocket seja bloqueado
  const startPolling = (jobId: string) => {
    const pollInterval = setInterval(async () => {
      try {
        const res = await fetch(`${BACKEND_URL}/api/v1/jobs/${jobId}`);
        if (!res.ok) return;
        const data = await res.json();

        if (data.progress !== undefined) {
          setProgressPercent(data.progress);
        }
        if (data.message) {
          setProgressMessage(data.message);
        }

        if (data.status === 'completed' && data.result) {
          clearInterval(pollInterval);
          onProcessComplete(data.result as ProcessBeatResponse);
        } else if (data.status === 'failed') {
          clearInterval(pollInterval);
          setIsProcessing(false);
          setErrorMessage(data.error || 'Falha no processamento.');
        }
      } catch (e) {
        console.warn('[Polling] Erro:', e);
      }
    }, 2000);
  };

  return (
    <div className="w-full max-w-2xl mx-auto my-12 px-4">
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => !isProcessing && fileInputRef.current?.click()}
        className={`relative border-2 border-dashed rounded-2xl p-10 flex flex-col items-center justify-center text-center transition-all duration-300 ${
          isDragging
            ? 'border-neon-cyan bg-neon-cyan/5 shadow-cyan-glow scale-[1.01]'
            : 'border-surface-border bg-surface/50 hover:border-neon-cyan/40 hover:bg-surface-highlight/30 cursor-pointer'
        }`}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".mp3,.wav"
          className="hidden"
          onChange={handleFileChange}
          disabled={isProcessing}
        />

        {isProcessing ? (
          <div className="flex flex-col items-center gap-6 py-6 w-full">
            <div className="relative">
              <div className="w-20 h-20 rounded-full border-4 border-surface-border border-t-neon-cyan animate-spin" />
              <div className="absolute inset-0 flex items-center justify-center">
                <Music className="w-8 h-8 text-neon-cyan animate-pulse" />
              </div>
            </div>

            <div className="space-y-2 max-w-md w-full">
              <h3 className="text-white text-base font-bold flex items-center justify-center gap-2">
                <Sparkles className="w-4 h-4 text-neon-cyan animate-bounce" />
                Processando "{selectedFileName}"
              </h3>
              
              <div className="flex items-center justify-between text-xs px-1">
                <span className="text-neon-cyan font-bold tracking-wide">
                  {progressMessage}
                </span>
                <span className="text-gray-400 font-mono font-bold">
                  {Math.round(progressPercent)}%
                </span>
              </div>
              
              {/* Barra de progresso real via WebSocket */}
              <div className="w-full h-2 bg-surface-highlight rounded-full overflow-hidden mt-3 border border-surface-border">
                <div 
                  className="h-full bg-gradient-to-r from-neon-cyan via-neon-purple to-neon-pink transition-all duration-500"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>

              <p className="text-gray-400 text-[11px] pt-2">
                Streaming em tempo real via WebSocket. O modelo HTDemucs e os filtros MIR
                estão rodando em background com aceleração CPU.
              </p>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-4 py-4">
            <div className="w-16 h-16 rounded-2xl bg-surface-highlight border border-surface-border flex items-center justify-center shadow-lg group-hover:border-neon-cyan/50 transition-colors">
              <Upload className="w-8 h-8 text-neon-cyan" />
            </div>

            <div className="space-y-1">
              <h2 className="text-white text-lg font-bold">
                Solte seu beat de Trap aqui
              </h2>
              <p className="text-gray-400 text-xs">
                Formatos suportados: <span className="text-neon-cyan">.MP3</span> ou{' '}
                <span className="text-neon-cyan">.WAV</span> (máx. 100 MB)
              </p>
            </div>

            <button
              type="button"
              className="mt-2 px-5 py-2 rounded-lg bg-neon-cyan/10 hover:bg-neon-cyan/20 border border-neon-cyan/30 text-neon-cyan text-xs font-bold transition-all shadow-cyan-glow"
            >
              Navegar no Computador
            </button>
          </div>
        )}

        {errorMessage && (
          <div className="mt-4 p-3 rounded-lg bg-red-950/40 border border-red-500/40 text-red-300 text-xs flex items-center gap-2 max-w-md text-left">
            <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0" />
            <span>{errorMessage}</span>
          </div>
        )}
      </div>

      {/* Dicas / Features */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-8">
        <div className="bg-surface/60 border border-surface-border rounded-xl p-4 flex items-start gap-3">
          <Disc className="w-5 h-5 text-neon-cyan flex-shrink-0 mt-0.5" />
          <div>
            <h4 className="text-white text-xs font-bold">Demucs 4 Stems</h4>
            <p className="text-gray-400 text-[11px] mt-1">
              Separação estúdio de Vocais, 808, Bateria e Melodia com HTDemucs.
            </p>
          </div>
        </div>

        <div className="bg-surface/60 border border-surface-border rounded-xl p-4 flex items-start gap-3">
          <Activity className="w-5 h-5 text-neon-purple flex-shrink-0 mt-0.5" />
          <div>
            <h4 className="text-white text-xs font-bold">Reator Visual 3D</h4>
            <p className="text-gray-400 text-[11px] mt-1">
              Three.js em 30 FPS sincronizado com os kicks, 808, hi-hats e melodia.
            </p>
          </div>
        </div>

        <div className="bg-surface/60 border border-surface-border rounded-xl p-4 flex items-start gap-3">
          <Music className="w-5 h-5 text-neon-green flex-shrink-0 mt-0.5" />
          <div>
            <h4 className="text-white text-xs font-bold">Piano Roll + MIDI</h4>
            <p className="text-gray-400 text-[11px] mt-1">
              Transcrição de notas com pitch-bend e download de arquivos .mid.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

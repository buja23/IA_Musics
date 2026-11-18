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
    <div className="w-full max-w-2xl mx-auto my-12 px-4 border border-[#121417] bg-[#1e2226]">
      <div className="h-7 bg-[#282d33] border-b border-[#121417] px-2 flex items-center justify-between text-[11px] text-[#d5dae0] font-mono">
        <span>Audio Importer — Stem &amp; MIR Engine</span>
        <span className="text-[9px] text-[#76e068]">FL AUDIO IN</span>
      </div>
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => !isProcessing && fileInputRef.current?.click()}
        className={`relative m-3 border border-dashed p-10 flex flex-col items-center justify-center text-center transition-all duration-300 ${
          isDragging
            ? 'border-[#ff7b00] bg-[#ff7b00]/10'
            : 'border-[#3a414a] bg-[#181b1f] hover:border-[#ff7b00]/70 cursor-pointer'
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
              <div className="w-20 h-20 rounded-full border-4 border-[#323840] border-t-[#ff7b00] animate-spin" />
              <div className="absolute inset-0 flex items-center justify-center">
                <Music className="w-8 h-8 text-[#76e068] animate-pulse" />
              </div>
            </div>

            <div className="space-y-2 max-w-md w-full">
              <h3 className="text-white text-base font-bold flex items-center justify-center gap-2">
                <Sparkles className="w-4 h-4 text-[#ff7b00] animate-bounce" />
                Processando "{selectedFileName}"
              </h3>
              
              <div className="flex items-center justify-between text-xs px-1">
                <span className="text-[#76e068] font-bold tracking-wide">
                  {progressMessage}
                </span>
                <span className="text-gray-400 font-mono font-bold">
                  {Math.round(progressPercent)}%
                </span>
              </div>
              
              {/* Barra de progresso real via WebSocket */}
              <div className="w-full h-2 bg-[#131619] overflow-hidden mt-3 border border-[#323840]">
                <div 
                  className="h-full bg-gradient-to-r from-[#76e068] to-[#ff7b00] transition-all duration-500"
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
            <div className="w-16 h-16 bg-[#323840] border border-[#121417] flex items-center justify-center transition-colors">
              <Upload className="w-8 h-8 text-[#ff7b00]" />
            </div>

            <div className="space-y-1">
              <h2 className="text-white text-lg font-bold">
                Solte seu beat de Trap aqui
              </h2>
              <p className="text-gray-400 text-xs">
                Formatos suportados: <span className="text-[#76e068]">.MP3</span> ou{' '}
                <span className="text-[#76e068]">.WAV</span> (máx. 100 MB)
              </p>
            </div>

            <button
              type="button"
              className="mt-2 px-5 py-2 bg-[#ff7b00] hover:bg-[#ff922e] border border-[#121417] text-[#121417] text-xs font-bold transition-all"
            >
              Navegar no Computador
            </button>
          </div>
        )}

        {errorMessage && (
          <div className="mt-4 p-3 bg-[#281719] border border-[#ef4444]/40 text-red-300 text-xs flex items-center gap-2 max-w-md text-left">
            <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0" />
            <span>{errorMessage}</span>
          </div>
        )}
      </div>

      {/* Dicas / Features */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-2 mt-3">
        <div className="bg-[#22262b] border border-[#323840] p-3 flex items-start gap-3">
          <Disc className="w-5 h-5 text-[#76e068] flex-shrink-0 mt-0.5" />
          <div>
            <h4 className="text-white text-xs font-bold">HTDemucs 4-Stems</h4>
            <p className="text-gray-400 text-[11px] mt-1">
              Separação estúdio de Vocais, 808, Bateria e Melodia com HTDemucs.
            </p>
          </div>
        </div>

        <div className="bg-[#22262b] border border-[#323840] p-3 flex items-start gap-3">
          <Activity className="w-5 h-5 text-[#ff7b00] flex-shrink-0 mt-0.5" />
          <div>
            <h4 className="text-white text-xs font-bold">ZGameEditor 3D</h4>
            <p className="text-gray-400 text-[11px] mt-1">
              Three.js em 30 FPS sincronizado com os kicks, 808, hi-hats e melodia.
            </p>
          </div>
        </div>

        <div className="bg-[#22262b] border border-[#323840] p-3 flex items-start gap-3">
          <Music className="w-5 h-5 text-[#38bdf8] flex-shrink-0 mt-0.5" />
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

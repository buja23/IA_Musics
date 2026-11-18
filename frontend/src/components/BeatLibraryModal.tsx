import React, { useEffect, useState } from 'react';
import { Library, Trash2, Play, Calendar, Music, X, Loader2, Sparkles, Clock } from 'lucide-react';
import { ProcessBeatResponse } from '../types';

interface BeatItem {
  job_id: string;
  original_filename: string;
  created_at: string;
  metadata: {
    duration_seconds: number;
    bpm: number;
    key: string;
  };
  stems: Array<{
    stem_name: 'drums' | 'bass' | 'other' | 'vocals';
    label: string;
    file_path: string;
  }>;
  midi_files: {
    melody: string;
    bass_808: string;
    vocals: string;
  };
  analysis_url: string;
}

interface BeatLibraryModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectBeat: (beat: ProcessBeatResponse) => void;
}

const BACKEND_URL = 'http://localhost:8000';

const formatSeconds = (sec: number) => {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
};

export const BeatLibraryModal: React.FC<BeatLibraryModalProps> = ({
  isOpen,
  onClose,
  onSelectBeat,
}) => {
  const [beats, setBeats] = useState<BeatItem[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const fetchBeats = async () => {
    setIsLoading(true);
    try {
      const res = await fetch(`${BACKEND_URL}/api/v1/beats`);
      if (res.ok) {
        const data = await res.json();
        setBeats(data);
      }
    } catch (err) {
      console.warn('Erro ao listar beats:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchBeats();
    }
  }, [isOpen]);

  const handleDelete = async (jobId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm(`Deseja realmente excluir o beat "${jobId}" do disco?`)) return;

    setDeletingId(jobId);
    try {
      const res = await fetch(`${BACKEND_URL}/api/v1/beats/${jobId}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        setBeats((prev) => prev.filter((b) => b.job_id !== jobId));
      }
    } catch (err) {
      console.warn('Erro ao excluir beat:', err);
    } finally {
      setDeletingId(null);
    }
  };

  const handleSelect = (b: BeatItem) => {
    const processResult: ProcessBeatResponse = {
      job_id: b.job_id,
      status: 'completed',
      processing_time_seconds: 0,
      stems: b.stems,
      metadata: {
        duration: b.metadata.duration_seconds,
        duration_seconds: b.metadata.duration_seconds,
        bpm: b.metadata.bpm,
        key: b.metadata.key,
      },
      analysis_url: b.analysis_url,
      midi_files: b.midi_files,
    };
    onSelectBeat(processResult);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-sm p-4">
      <div className="w-full max-w-3xl bg-[#1e2226] border border-[#121417] flex flex-col max-h-[85vh] overflow-hidden">
        {/* Header do Modal */}
        <div className="h-8 px-3 bg-[#282d33] border-b border-[#121417] flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-6 h-6 border border-[#121417] bg-[#323840] flex items-center justify-center">
              <Library className="w-3.5 h-3.5 text-[#76e068]" />
            </div>
            <div>
              <h3 className="text-white font-bold text-sm tracking-wider flex items-center gap-2">
                BIBLIOTECA DE BEATS SALVOS
                <span className="text-[10px] px-2 py-0.5 bg-[#131619] text-[#76e068] border border-[#323840] font-mono">
                  {beats.length} {beats.length === 1 ? 'beat' : 'beats'}
                </span>
              </h3>
              <p className="text-gray-400 text-xs">
                Selecione um beat para carregar no estúdio sem precisar reprocessar
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="h-6 w-6 grid place-items-center bg-[#323840] text-[#aeb5bd] hover:text-white border border-[#121417] transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Lista de Beats */}
        <div className="p-6 overflow-y-auto flex-1 flex flex-col gap-3">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3 text-gray-400">
              <Loader2 className="w-7 h-7 text-[#76e068] animate-spin" />
              <span className="text-xs font-mono">Consultando static/outputs/...</span>
            </div>
          ) : beats.length === 0 ? (
            <div className="text-center py-16 text-gray-400 text-xs space-y-2">
              <Music className="w-10 h-10 text-gray-600 mx-auto" />
              <p className="font-bold text-gray-300">Nenhum beat salvo na biblioteca.</p>
              <p className="text-gray-500 text-[11px]">
                Envie um beat via Drag & Drop na tela inicial para salvá-lo automaticamente!
              </p>
            </div>
          ) : (
            beats.map((beat) => (
              <div
                key={beat.job_id}
                className="group bg-[#24292f] hover:bg-[#2b3036] border border-[#323840] hover:border-[#ff7b00] p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 transition-all"
              >
                <div className="flex items-start sm:items-center gap-3.5">
                  <div className="w-11 h-11 bg-[#131619] border border-[#323840] group-hover:border-[#ff7b00] flex items-center justify-center transition-all flex-shrink-0">
                    <Music className="w-5 h-5 text-[#76e068]" />
                  </div>

                  <div className="space-y-1">
                    <h4 className="text-white text-xs font-bold group-hover:text-[#ff7b00] transition-colors line-clamp-1">
                      {beat.original_filename}
                    </h4>
                    <div className="flex flex-wrap items-center gap-2.5 text-[11px] text-gray-400 font-mono">
                      <span className="px-1.5 py-0.5 bg-[#131619] border border-[#323840]">
                        BPM: <strong className="text-[#76e068]">{beat.metadata.bpm}</strong>
                      </span>
                      <span className="px-1.5 py-0.5 bg-[#131619] border border-[#323840]">
                        TOM: <strong className="text-[#76e068]">{beat.metadata.key}</strong>
                      </span>
                      <span className="flex items-center gap-1 text-gray-400">
                        <Clock className="w-3 h-3 text-gray-500" />
                        {formatSeconds(beat.metadata.duration_seconds)}
                      </span>
                      <span className="flex items-center gap-1 text-gray-500">
                        <Calendar className="w-3 h-3" />
                        {new Date(beat.created_at).toLocaleDateString('pt-BR')}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Ações Explícitas: Abrir no Estúdio e Excluir */}
                <div className="flex items-center gap-2 self-end sm:self-center">
                  <button
                    onClick={() => handleSelect(beat)}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-[#ff7b00] hover:bg-[#ff922e] border border-[#121417] text-[#121417] text-xs font-bold transition-all cursor-pointer"
                  >
                    <Play className="w-3.5 h-3.5 fill-[#121417]" />
                    <span>Abrir no Estúdio</span>
                  </button>

                  <button
                    onClick={(e) => handleDelete(beat.job_id, e)}
                    disabled={deletingId === beat.job_id}
                    className="flex items-center gap-1 px-2.5 py-1.5 bg-[#323840] hover:bg-[#281719] border border-[#121417] hover:border-[#ef4444]/50 text-[#aeb5bd] hover:text-[#ef4444] text-xs transition-colors cursor-pointer disabled:opacity-50"
                    title="Excluir beat permanentemente"
                  >
                    {deletingId === beat.job_id ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <>
                        <Trash2 className="w-3.5 h-3.5" />
                        <span className="hidden md:inline">Excluir</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};

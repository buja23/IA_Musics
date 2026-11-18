import React, { useState, useEffect, useMemo } from 'react';
import { Header } from './components/Header';
import { UploadArea } from './components/UploadArea';
import { StemMixer } from './components/StemMixer';
import { VisualReactor3D } from './components/VisualReactor3D';
import { PianoRollCanvas } from './components/PianoRollCanvas';
import { PlayerControls } from './components/PlayerControls';
import { BeatLibraryModal } from './components/BeatLibraryModal';
import { useStemAudio } from './hooks/useStemAudio';
import { ProcessBeatResponse, AnalysisData, StemType } from './types';
import { Eye, Music2 } from 'lucide-react';

const BACKEND_URL = 'http://localhost:8000';

export function App() {
  const [processResult, setProcessResult] = useState<ProcessBeatResponse | null>(null);
  const [analysis, setAnalysis] = useState<AnalysisData | null>(null);
  const [activeTab, setActiveTab] = useState<'both' | 'visual' | 'pianoroll'>('both');
  const [isLibraryOpen, setIsLibraryOpen] = useState<boolean>(false);

  // Mapeamento dos stems para o player de áudio
  const stemsMap = useMemo(() => {
    if (!processResult) return null;
    const map: Record<StemType, string> = {
      drums: '',
      bass: '',
      other: '',
      vocals: '',
    };
    processResult.stems.forEach((s) => {
      const fullUrl = s.file_path.startsWith('http')
        ? s.file_path
        : `${BACKEND_URL}${s.file_path.startsWith('/') ? '' : '/'}${s.file_path}`;
      map[s.stem_name] = fullUrl;
    });
    return map;
  }, [processResult]);

  const effectiveDuration =
    processResult?.metadata?.duration ||
    processResult?.metadata?.duration_seconds ||
    analysis?.metadata?.duration ||
    analysis?.metadata?.duration_seconds ||
    0;

  const {
    isPlaying,
    currentTime,
    channels,
    isLoop,
    masterVolume,
    setIsLoop,
    setMasterVolume,
    togglePlay,
    seek,
    toggleMute,
    toggleSolo,
    setVolume,
    getAudioStream,
  } = useStemAudio({
    stems: stemsMap,
    duration: effectiveDuration,
  });

  // Quando o processamento termina, busca os dados detalhados da análise
  useEffect(() => {
    if (!processResult?.job_id) return;

    const fetchAnalysis = async () => {
      try {
        const res = await fetch(`${BACKEND_URL}/api/v1/analysis/${processResult.job_id}`);
        if (res.ok) {
          const data: AnalysisData = await res.json();
          setAnalysis(data);
        }
      } catch (err) {
        console.warn('Erro ao carregar analysis.json:', err);
      }
    };

    fetchAnalysis();
  }, [processResult?.job_id]);

  const handleReset = () => {
    setProcessResult(null);
    setAnalysis(null);
  };

  // Normalização de dados do analysis
  const notes = analysis?.notes || analysis?.transcription;
  const drums = analysis?.drums || analysis?.drum_mapping;
  const envelopes = analysis?.envelopes_30fps || analysis?.energy_envelopes;

  return (
    <div className="min-h-screen bg-background text-gray-200 flex flex-col cyber-grid relative">
      <Header
        hasTrack={!!processResult}
        onReset={handleReset}
        onOpenLibrary={() => setIsLibraryOpen(true)}
        bpm={processResult?.metadata?.bpm}
        keySignature={processResult?.metadata?.key}
      />

      <BeatLibraryModal
        isOpen={isLibraryOpen}
        onClose={() => setIsLibraryOpen(false)}
        onSelectBeat={(beat) => {
          setProcessResult(beat);
        }}
      />

      <main
        className={`flex-1 w-full max-w-[1600px] mx-auto p-4 md:p-6 flex flex-col ${
          processResult ? 'pb-36' : ''
        }`}
      >
        {!processResult ? (
          <UploadArea onProcessComplete={(data) => setProcessResult(data)} />
        ) : (
          <div className="flex flex-col lg:flex-row gap-6 items-start">
            {/* Coluna Principal: Visualizador 3D + Piano Roll */}
            <div className="flex-1 w-full flex flex-col gap-6">
              {/* Controles de Modo de Visualização */}
              <div className="flex items-center justify-between bg-surface/70 border border-surface-border p-2 rounded-xl">
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setActiveTab('both')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                      activeTab === 'both'
                        ? 'bg-neon-cyan/20 text-neon-cyan border border-neon-cyan/50 shadow-cyan-glow'
                        : 'text-gray-400 hover:text-white'
                    }`}
                  >
                    Visualização Dupla
                  </button>

                  <button
                    onClick={() => setActiveTab('visual')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                      activeTab === 'visual'
                        ? 'bg-neon-cyan/20 text-neon-cyan border border-neon-cyan/50 shadow-cyan-glow'
                        : 'text-gray-400 hover:text-white'
                    }`}
                  >
                    <Eye className="w-3.5 h-3.5" />
                    Reator 3D
                  </button>

                  <button
                    onClick={() => setActiveTab('pianoroll')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                      activeTab === 'pianoroll'
                        ? 'bg-neon-cyan/20 text-neon-cyan border border-neon-cyan/50 shadow-cyan-glow'
                        : 'text-gray-400 hover:text-white'
                    }`}
                  >
                    <Music2 className="w-3.5 h-3.5" />
                    Piano Roll
                  </button>
                </div>

                <div className="text-[11px] font-mono text-gray-400">
                  JOB: <span className="text-neon-cyan">{processResult.job_id}</span>
                </div>
              </div>

              {/* Reator 3D com Gravador de Vídeo Integrado */}
              {(activeTab === 'both' || activeTab === 'visual') && (
                <VisualReactor3D
                  currentTime={currentTime}
                  duration={effectiveDuration}
                  jobId={processResult.job_id}
                  envelopes={envelopes}
                  drums={drums}
                  isPlaying={isPlaying}
                  getAudioStream={getAudioStream}
                />
              )}

              {/* Piano Roll & Drum Grid */}
              {(activeTab === 'both' || activeTab === 'pianoroll') && (
                <PianoRollCanvas
                  currentTime={currentTime}
                  duration={effectiveDuration}
                  melodyNotes={notes?.melody}
                  bassNotes={notes?.bass_808}
                  vocalNotes={notes?.vocals}
                  drums={drums}
                  metadata={processResult.metadata}
                />
              )}
            </div>

            {/* Coluna Lateral: Stem Mixer */}
            <StemMixer
              channels={channels}
              onToggleMute={toggleMute}
              onToggleSolo={toggleSolo}
              onVolumeChange={setVolume}
              stemsUrls={stemsMap || { drums: '', bass: '', other: '', vocals: '' }}
              midiFiles={processResult.midi_files}
              masterVolume={masterVolume}
              onMasterVolumeChange={setMasterVolume}
            />
          </div>
        )}
      </main>

      {/* Dock Fixa de Transporte no Rodapé */}
      {processResult && (
        <div className="sticky bottom-0 z-40 w-full">
          <PlayerControls
            isPlaying={isPlaying}
            onTogglePlay={togglePlay}
            currentTime={currentTime}
            duration={effectiveDuration}
            onSeek={seek}
            isLoop={isLoop}
            onToggleLoop={() => setIsLoop(!isLoop)}
          />
        </div>
      )}
    </div>
  );
}

export default App;

import React, { useState, useEffect, useMemo } from 'react';
import { Header } from './components/Header';
import { UploadArea } from './components/UploadArea';
import { StemMixer } from './components/StemMixer';
import { VisualReactor3D } from './components/VisualReactor3D';
import { PianoRollCanvas } from './components/PianoRollCanvas';
import { BeatLibraryPanel } from './components/BeatLibraryPanel';
import { BeatLibraryModal } from './components/BeatLibraryModal';
import { useStemAudio } from './hooks/useStemAudio';
import { ProcessBeatResponse, AnalysisData, StemType } from './types';

const BACKEND_URL = 'http://localhost:8000';

export function App() {
  const [processResult, setProcessResult] = useState<ProcessBeatResponse | null>(null);
  const [analysis, setAnalysis] = useState<AnalysisData | null>(null);
  const [activeTab, setActiveTab] = useState<'both' | 'visual' | 'pianoroll'>('both');
  const [isLibraryOpen, setIsLibraryOpen] = useState<boolean>(false);
  const [browserCollapsed, setBrowserCollapsed] = useState<boolean>(false);

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
    effectiveGainsRef,
    getFrequencyData,
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
    <div className="h-screen overflow-hidden bg-[#181b1f] text-[#d7dce2] flex flex-col">
      <Header
        hasTrack={!!processResult}
        onReset={handleReset}
        onOpenLibrary={() => setIsLibraryOpen(true)}
        isPlaying={isPlaying}
        onTogglePlay={togglePlay}
        onStop={() => seek(0)}
        isLoop={isLoop}
        onToggleLoop={() => setIsLoop(!isLoop)}
        currentTime={currentTime}
        duration={effectiveDuration}
        onSeek={seek}
        getFrequencyData={getFrequencyData}
        activeTab={activeTab}
        onActiveTabChange={setActiveTab}
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

      <div className="flex-1 min-h-0 flex">
        {processResult && (
          <BeatLibraryPanel
            collapsed={browserCollapsed}
            onToggle={() => setBrowserCollapsed((value) => !value)}
            onSelectBeat={(beat) => setProcessResult(beat)}
            onOpenModal={() => setIsLibraryOpen(true)}
            stemsUrls={stemsMap || undefined}
            midiFiles={processResult.midi_files}
          />
        )}

        <main className="flex-1 min-w-0 min-h-0 overflow-auto bg-[#1e2226]">
        {!processResult ? (
          <UploadArea onProcessComplete={(data) => setProcessResult(data)} />
        ) : (
          <div className="flex flex-row items-stretch min-h-full">
            {/* Coluna Principal: Visualizador 3D + Piano Roll */}
            <div className="flex-1 min-w-0 flex flex-col gap-2 p-2">
              {/* Reator 3D com Gravador de Vídeo Integrado */}
              {(activeTab === 'both' || activeTab === 'visual') && (
                <VisualReactor3D
                  currentTime={currentTime}
                  duration={effectiveDuration}
                  jobId={processResult.job_id}
                  envelopes={envelopes}
                  drums={drums}
                  bassNotes={notes?.bass_808}
                  effectiveGainsRef={effectiveGainsRef}
                  getFrequencyData={getFrequencyData}
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
              getFrequencyData={getFrequencyData}
              envelopes={envelopes}
              effectiveGainsRef={effectiveGainsRef}
              currentTime={currentTime}
            />
          </div>
        )}
        </main>
      </div>
    </div>
  );
}

export default App;

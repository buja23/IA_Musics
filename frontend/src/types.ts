export type StemType = 'drums' | 'bass' | 'other' | 'vocals';

export interface StemInfo {
  stem_name: StemType;
  label: string;
  file_path: string;
}

export interface BeatMetadata {
  duration?: number;
  duration_seconds?: number;
  bpm: number;
  key: string;
}

export interface MidiFiles {
  melody: string;
  bass_808: string;
  vocals: string;
}

export interface NoteEvent {
  note_name: string;
  midi: number;
  start: number;
  end: number;
  velocity: number;
  pitch_bend?: number[];
}

export interface DrumHit {
  time: number;
  intensity: number;
}

export interface DrumMapping {
  kicks: DrumHit[];
  snares_claps: DrumHit[];
  hihats: DrumHit[];
}

export interface EnergyEnvelopes {
  vocals: number[];
  drums: number[];
  bass: number[];
  other: number[];
}

export interface AnalysisData {
  job_id: string;
  metadata: BeatMetadata;
  notes?: {
    melody: NoteEvent[];
    bass_808: NoteEvent[];
    vocals: NoteEvent[];
  };
  transcription?: {
    melody: NoteEvent[];
    bass_808: NoteEvent[];
    vocals: NoteEvent[];
  };
  drums?: DrumMapping;
  drum_mapping?: DrumMapping;
  envelopes_30fps?: EnergyEnvelopes;
  energy_envelopes?: EnergyEnvelopes;
  midi_files?: MidiFiles;
}

export interface ProcessBeatResponse {
  job_id: string;
  status: string;
  processing_time_seconds: number;
  stems: StemInfo[];
  metadata: BeatMetadata;
  analysis_url: string;
  midi_files: MidiFiles;
}

export interface StemChannelState {
  muted: boolean;
  solo: boolean;
  volume: number; // 0.0 to 1.0
}

export interface ActiveNotesState {
  melody: string | null;
  bass_808: string | null;
  vocals: string | null;
}

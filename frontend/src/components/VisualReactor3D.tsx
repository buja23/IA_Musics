import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { Video, Square, Download } from 'lucide-react';
import { EnergyEnvelopes, DrumMapping, NoteEvent, StemType } from '../types';
import type { MutableRefObject } from 'react';

interface VisualReactor3DProps {
  currentTime: number;
  duration?: number;
  jobId?: string;
  envelopes?: EnergyEnvelopes;
  drums?: DrumMapping;
  bassNotes?: NoteEvent[];
  effectiveGainsRef?: MutableRefObject<Record<StemType, number>>;
  getFrequencyData?: () => Uint8Array;
  isPlaying: boolean;
  getAudioStream?: () => Promise<MediaStream | null> | MediaStream | null;
}

export const VisualReactor3D: React.FC<VisualReactor3DProps> = ({
  currentTime,
  duration = 0,
  jobId = 'clip',
  envelopes,
  drums,
  bassNotes = [],
  effectiveGainsRef,
  getFrequencyData,
  isPlaying,
  getAudioStream,
}) => {
  const mountRef = useRef<HTMLDivElement | null>(null);

  // Estados de Gravação de Vídeo
  const [isRecording, setIsRecording] = useState<boolean>(false);
  const [recordingSeconds, setRecordingSeconds] = useState<number>(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const recordTimerRef = useRef<number | null>(null);

  // Refs de estado para a animação sem recriar o renderer a cada frame
  const stateRef = useRef({
    currentTime: 0,
    isPlaying: false,
    envelopes,
    drums,
    bassNotes,
    effectiveGainsRef,
    getFrequencyData,
    lastKickTime: -1,
    lastSnareTime: -1,
    lastHihatTime: -1,
    shakeIntensity: 0,
    particleSpeed: 0.001,
  });

  useEffect(() => {
    stateRef.current.currentTime = currentTime;
    stateRef.current.isPlaying = isPlaying;
    stateRef.current.envelopes = envelopes;
    stateRef.current.drums = drums;
    stateRef.current.bassNotes = bassNotes;
    stateRef.current.effectiveGainsRef = effectiveGainsRef;
    stateRef.current.getFrequencyData = getFrequencyData;
  }, [currentTime, isPlaying, envelopes, drums, bassNotes, effectiveGainsRef, getFrequencyData]);

  // Se estiver gravando e a música terminar, finaliza automaticamente
  useEffect(() => {
    if (isRecording && duration > 0 && currentTime >= duration - 0.2) {
      stopRecording();
    }
  }, [currentTime, duration, isRecording]);

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    // Dimensões do container
    const width = container.clientWidth || 600;
    const height = container.clientHeight || 450;

    // 1. Cena, Câmera e Renderer
    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x06090f, 0.035);

    const camera = new THREE.PerspectiveCamera(50, width / height, 0.1, 1000);
    const initialCameraPos = new THREE.Vector3(0, 0, 8);
    camera.position.copy(initialCameraPos);

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      preserveDrawingBuffer: true, // Importante para captureStream() de alta fidelidade
    });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;
    container.appendChild(renderer.domElement);

    // 2. Luzes
    const ambientLight = new THREE.AmbientLight(0x00f0ff, 0.4);
    scene.add(ambientLight);

    const vocalPointLight = new THREE.PointLight(0xf43f5e, 2, 20);
    vocalPointLight.position.set(0, 0, 0);
    scene.add(vocalPointLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 1.2);
    directionalLight.position.set(5, 5, 5);
    scene.add(directionalLight);

    // 3. Núcleo Geométrico Central: Icosaedro Wireframe + Outer Glow (808 / Bass e Kicks)
    const coreGroup = new THREE.Group();
    scene.add(coreGroup);

    // Geometria wireframe externa
    const icoGeo = new THREE.IcosahedronGeometry(1.6, 2);
    const icoMat = new THREE.MeshStandardMaterial({
      color: 0x00f0ff,
      wireframe: true,
      roughness: 0.2,
      metalness: 0.8,
      emissive: 0x004060,
      emissiveIntensity: 0.5,
    });
    const icosahedron = new THREE.Mesh(icoGeo, icoMat);
    coreGroup.add(icosahedron);

    // Núcleo interno emissivo (Vocais)
    const innerGeo = new THREE.SphereGeometry(0.85, 32, 32);
    const innerMat = new THREE.MeshStandardMaterial({
      color: 0x0b111e,
      emissive: 0xec4899,
      emissiveIntensity: 0.2,
      roughness: 0.1,
      metalness: 0.9,
    });
    const innerSphere = new THREE.Mesh(innerGeo, innerMat);
    coreGroup.add(innerSphere);

    // 4. Anéis Expansivos de Onda de Choque (Snares / Claps)
    const RINGS_COUNT = 5;
    const rings: { mesh: THREE.Mesh; active: boolean; scale: number; opacity: number }[] = [];
    const ringGeo = new THREE.RingGeometry(1.8, 1.95, 64);

    for (let i = 0; i < RINGS_COUNT; i++) {
      const ringMat = new THREE.MeshBasicMaterial({
        color: 0x00f0ff,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
      });
      const ringMesh = new THREE.Mesh(ringGeo, ringMat);
      ringMesh.rotation.x = Math.PI / 2;
      scene.add(ringMesh);
      rings.push({ mesh: ringMesh, active: false, scale: 1, opacity: 0 });
    }

    // 5. Campo de Partículas Estelares (Hi-Hats)
    const PARTICLE_COUNT = 700;
    const particleGeo = new THREE.BufferGeometry();
    const particlePos = new Float32Array(PARTICLE_COUNT * 3);
    const particleColors = new Float32Array(PARTICLE_COUNT * 3);

    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const r = 3.5 + Math.random() * 8.0;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(Math.random() * 2 - 1);

      particlePos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      particlePos[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      particlePos[i * 3 + 2] = r * Math.cos(phi);

      particleColors[i * 3] = 0.0;
      particleColors[i * 3 + 1] = 0.9 + Math.random() * 0.1;
      particleColors[i * 3 + 2] = 1.0;
    }

    particleGeo.setAttribute('position', new THREE.BufferAttribute(particlePos, 3));
    particleGeo.setAttribute('color', new THREE.BufferAttribute(particleColors, 3));

    const particleMat = new THREE.PointsMaterial({
      size: 0.05,
      vertexColors: true,
      transparent: true,
      opacity: 0.6,
      blending: THREE.AdditiveBlending,
    });
    const particleSystem = new THREE.Points(particleGeo, particleMat);
    scene.add(particleSystem);

    // Função de trigger de shockwave (Snares / Claps)
    const triggerShockwave = (intensity: number) => {
      const ring = rings.find((r) => !r.active) || rings[0];
      ring.active = true;
      ring.scale = 1.0;
      ring.opacity = Math.min(1.0, 0.5 + intensity * 0.5);
      ring.mesh.scale.set(1, 1, 1);
      (ring.mesh.material as THREE.MeshBasicMaterial).opacity = ring.opacity;
    };

    // 6. Loop de Renderização Principal
    let animationFrameId: number;
    let clock = new THREE.Clock();

    const animate = () => {
      animationFrameId = requestAnimationFrame(animate);

      const delta = clock.getDelta();
      const time = stateRef.current.currentTime;
      const frameIdx = Math.floor(time * 30);
      const isPlay = stateRef.current.isPlaying;

      // Valores dos envelopes em 30 FPS
      const env = stateRef.current.envelopes;
      const bassVal = env?.bass?.[frameIdx] ?? 0;
      const drumsVal = env?.drums?.[frameIdx] ?? 0;
      const vocalsVal = env?.vocals?.[frameIdx] ?? 0;
      const otherVal = env?.other?.[frameIdx] ?? 0;

      // A) Baixo / 808 e Kicks: Escala do núcleo e rotação
      const gains = stateRef.current.effectiveGainsRef?.current;
      const bassGain = gains?.bass ?? 1;
      const drumsGain = gains?.drums ?? 1;
      const vocalsGain = gains?.vocals ?? 1;
      const otherGain = gains?.other ?? 1;

      const activeBass = stateRef.current.bassNotes?.find((n) => time >= n.start && time <= n.end);
      const bend = activeBass?.pitch_bend?.[Math.min(activeBass.pitch_bend.length - 1, Math.floor(time * 30) % activeBass.pitch_bend.length)] ?? 0;
      const midi = activeBass?.midi ?? 45;

      const targetScale = 1.0 + bassVal * bassGain * 0.55 + drumsVal * drumsGain * 0.25;
      coreGroup.scale.lerp(
        new THREE.Vector3(targetScale, targetScale * (1 + bend * 0.28), targetScale),
        0.2
      );
      coreGroup.rotation.z = bend * 0.018;
      icoMat.opacity = bassGain > 0 ? 1 : 0.1;
      icoMat.transparent = true;
      icoMat.wireframe = true;

      // Rotação suave contínua
      coreGroup.rotation.x += 0.008 + otherVal * 0.015;
      coreGroup.rotation.y += 0.012 + bassVal * 0.02;

      // B) Detecção de Kicks para Camera Shake
      const drumData = stateRef.current.drums;
      if (drumData?.kicks && isPlay && drumsGain > 0) {
        const recentKick = drumData.kicks.find(
          (k) => Math.abs(k.time - time) < 0.05
        );
        if (recentKick && recentKick.time !== stateRef.current.lastKickTime) {
          stateRef.current.lastKickTime = recentKick.time;
          stateRef.current.shakeIntensity = 0.12 * recentKick.intensity;
        }
      }

      // Aplica Camera Shake com decaimento suave
      stateRef.current.shakeIntensity *= drumsGain;
      if (stateRef.current.shakeIntensity > 0.001) {
        camera.position.x =
          initialCameraPos.x +
          (Math.random() - 0.5) * stateRef.current.shakeIntensity;
        camera.position.y =
          initialCameraPos.y +
          (Math.random() - 0.5) * stateRef.current.shakeIntensity;
        stateRef.current.shakeIntensity *= 0.88;
      } else {
        camera.position.copy(initialCameraPos);
      }

      // C) Detecção de Snares / Claps para disparar Shockwaves
      if (drumData?.snares_claps && isPlay && drumsGain > 0) {
        const recentSnare = drumData.snares_claps.find(
          (s) => Math.abs(s.time - time) < 0.05
        );
        if (recentSnare && recentSnare.time !== stateRef.current.lastSnareTime) {
          stateRef.current.lastSnareTime = recentSnare.time;
          triggerShockwave(recentSnare.intensity);
        }
      }

      // Animação dos anéis de choque
      rings.forEach((r) => {
        if (r.active) {
          r.scale += delta * 7.5;
          r.opacity -= delta * 1.8;
          r.mesh.scale.set(r.scale, r.scale, r.scale);
          (r.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(
            0,
            r.opacity
          );
          if (r.opacity <= 0) {
            r.active = false;
          }
        }
      });

      // D) Hi-Hats: Acelera rotação e brilho das partículas
      let hihatIntensity = 0;
      if (drumData?.hihats && isPlay && drumsGain > 0) {
        const recentHat = drumData.hihats.find(
          (h) => Math.abs(h.time - time) < 0.06
        );
        if (recentHat) {
          hihatIntensity = recentHat.intensity;
        }
      }

      const rotSpeed = 0.001 + hihatIntensity * drumsGain * 0.015 + drumsVal * drumsGain * 0.004;
      particleSystem.rotation.y += rotSpeed;
      particleSystem.rotation.z += rotSpeed * 0.5;
      particleMat.opacity = drumsGain > 0 ? (0.4 + hihatIntensity * 0.5 + drumsVal * 0.2) : 0.1;
      particleMat.size = 0.05 + hihatIntensity * drumsGain * 0.04;

      // E) Vocais: Emissão luminosa e cor do núcleo interno
      innerMat.emissiveIntensity = (0.3 + vocalsVal * 3.5) * vocalsGain;
      innerMat.opacity = vocalsGain > 0 ? 1 : 0.1;
      innerMat.transparent = true;
      innerSphere.scale.setScalar(vocalsGain > 0 ? 0.82 + vocalsVal * vocalsGain * 0.35 : 0.45);
      vocalPointLight.intensity = vocalsGain > 0 ? 1.0 + vocalsVal * vocalsGain * 4.0 : 0;

      // F) Melodia: Modulação sutil da matiz de cor do ambiente
      const hue = (time * 0.04 + otherVal * otherGain * 0.2) % 1.0;
      ambientLight.color.setHSL(0.52 + hue * 0.2, 0.9, 0.4);
      icoMat.emissive.setHSL(0.52 + hue * 0.2, 0.9, 0.2 + otherVal * 0.3);

      icosahedron.geometry.rotateY(((midi - 45) / 48) * 0.0008);
      renderer.render(scene, camera);
    };

    animate();

    // Resize Handler
    const handleResize = () => {
      if (!container) return;
      const newW = container.clientWidth;
      const newH = container.clientHeight;
      camera.aspect = newW / newH;
      camera.updateProjectionMatrix();
      renderer.setSize(newW, newH);
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      cancelAnimationFrame(animationFrameId);
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
      renderer.dispose();
      icoGeo.dispose();
      icoMat.dispose();
      innerGeo.dispose();
      innerMat.dispose();
      ringGeo.dispose();
      particleGeo.dispose();
      particleMat.dispose();
    };
  }, []);

  // Inicia a gravação do clipe em vídeo com áudio mixado (prioridade MP4 nativo + fallback WebM)
  const startRecording = async () => {
    const canvas = mountRef.current?.querySelector('canvas');
    if (!canvas) {
      alert('Canvas 3D não encontrado para gravação.');
      return;
    }

    try {
      // 1. Capturar stream de vídeo do Canvas a 30 FPS
      const videoStream = (canvas as any).captureStream
        ? (canvas as any).captureStream(30)
        : null;

      if (!videoStream) {
        alert('Seu navegador não suporta captureStream() em Canvas.');
        return;
      }

      // 2. Garantir que o AudioContext esteja ativo e capturar stream de áudio mixado
      const audioStream = getAudioStream ? await getAudioStream() : null;

      // 3. Combinar faixas de vídeo e áudio
      const tracks: MediaStreamTrack[] = [
        ...videoStream.getVideoTracks(),
        ...(audioStream ? audioStream.getAudioTracks() : []),
      ];
      const combinedStream = new MediaStream(tracks);

      // 4. Selecionar codec com prioridade para MP4 nativo (compatibilidade Windows Media Player)
      const candidateMimeTypes = [
        'video/mp4;codecs=avc1,mp4a.40.2',
        'video/mp4',
        'video/webm;codecs=vp8,opus',
        'video/webm',
      ];
      const chosenMimeType =
        candidateMimeTypes.find((mime) => MediaRecorder.isTypeSupported(mime)) || '';

      const ext = chosenMimeType.includes('mp4') ? 'mp4' : 'webm';

      recordedChunksRef.current = [];
      const mediaRecorder = new MediaRecorder(combinedStream, {
        ...(chosenMimeType ? { mimeType: chosenMimeType } : {}),
        videoBitsPerSecond: 4_000_000, // 4 Mbps
      });

      mediaRecorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          recordedChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        if (recordedChunksRef.current.length === 0) {
          console.warn('Nenhum dado capturado durante a gravação.');
          return;
        }

        const blob = new Blob(recordedChunksRef.current, {
          type: chosenMimeType || 'video/webm',
        });

        if (blob.size === 0) {
          console.warn('O arquivo de vídeo gravado está vazio.');
          return;
        }

        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `trap-ai-visualizer-${jobId}.${ext}`;
        document.body.appendChild(a);
        a.click();

        // Limpeza segura da URL após 1 segundo para garantir gravação concluída no disco
        setTimeout(() => {
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
        }, 1000);
      };

      // Inicia gravação com timeslice de 250ms para flush contínuo dos dados
      mediaRecorder.start(250);
      mediaRecorderRef.current = mediaRecorder;
      setIsRecording(true);
      setRecordingSeconds(0);

      // Temporizador visual
      recordTimerRef.current = window.setInterval(() => {
        setRecordingSeconds((prev) => prev + 1);
      }, 1000);
    } catch (err) {
      console.error('Erro ao iniciar gravação de clipe:', err);
      alert('Falha ao iniciar gravação. Verifique as permissões de mídia do navegador.');
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    if (recordTimerRef.current) {
      clearInterval(recordTimerRef.current);
      recordTimerRef.current = null;
    }
    setIsRecording(false);
  };

  const formatRecTime = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <div className="relative w-full h-[360px] md:h-[450px] bg-background/90 rounded-2xl border border-surface-border overflow-hidden shadow-2xl">
      {/* Three.js Canvas Container */}
      <div ref={mountRef} className="w-full h-full cursor-grab active:cursor-grabbing" />

      {/* Overlay com HUD de Métricas Reativas em tempo real */}
      <div className="absolute top-4 left-4 flex flex-wrap gap-2 pointer-events-none">
        <div className="bg-surface/80 backdrop-blur-md border border-surface-border px-2.5 py-1 rounded-md text-[10px] text-gray-300 flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-neon-cyan animate-pulse" />
          <span>REATOR 3D (30 FPS)</span>
        </div>

        {envelopes && (
          <div className="bg-surface/80 backdrop-blur-md border border-surface-border px-2.5 py-1 rounded-md text-[10px] font-mono flex items-center gap-2">
            <span className="text-neon-cyan">
              808:{' '}
              {Math.round(
                (envelopes.bass?.[Math.floor(currentTime * 30)] ?? 0) * 100
              )}
              %
            </span>
            <span className="text-neon-pink">
              VOZ:{' '}
              {Math.round(
                (envelopes.vocals?.[Math.floor(currentTime * 30)] ?? 0) * 100
              )}
              %
            </span>
            <span className="text-neon-orange">
              DRUM:{' '}
              {Math.round(
                (envelopes.drums?.[Math.floor(currentTime * 30)] ?? 0) * 100
              )}
              %
            </span>
          </div>
        )}
      </div>

      {/* Botão de Exportação de Clipe em Vídeo no Canto Superior Direito */}
      <div className="absolute top-4 right-4 z-10 flex items-center gap-2">
        {isRecording ? (
          <button
            onClick={stopRecording}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-red-600/90 hover:bg-red-500 text-white text-xs font-mono font-bold border border-red-400 shadow-[0_0_15px_rgba(239,68,68,0.5)] transition-all cursor-pointer animate-pulse"
            title="Parar gravação e baixar clipe de vídeo"
          >
            <Square className="w-3.5 h-3.5 fill-white" />
            <span>● REC {formatRecTime(recordingSeconds)} — Parar e Baixar</span>
          </button>
        ) : (
          <button
            onClick={startRecording}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface/80 hover:bg-neon-cyan/20 backdrop-blur-md text-gray-200 hover:text-neon-cyan text-xs font-bold border border-surface-border hover:border-neon-cyan/50 shadow-lg transition-all cursor-pointer"
            title="Gravar vídeo do visualizador 3D sincronizado com o áudio"
          >
            <Video className="w-3.5 h-3.5 text-neon-cyan" />
            <span>Gravar Clipe</span>
          </button>
        )}
      </div>

      <div className="absolute bottom-4 right-4 pointer-events-none text-right">
        <span className="text-[10px] font-mono text-gray-500">
          WEBGL / THREE.JS + MP4/WEBM CAPTURE
        </span>
      </div>
    </div>
  );
};

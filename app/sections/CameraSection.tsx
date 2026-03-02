'use client'

import React, { useState, useRef, useEffect, useCallback } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { FaVideo, FaVideoSlash, FaMusic, FaGuitar, FaDrum, FaVolumeUp, FaHandPaper } from 'react-icons/fa'
import type { InstrumentType, MotionData, MotionSnapshot } from './InstrumentSection'

interface CameraSectionProps {
  currentInstrument: InstrumentType
  setCurrentInstrument: (i: InstrumentType) => void
  isPlaying: boolean
  setIsPlaying: (v: boolean) => void
  isRecording: boolean
  recordingRef: React.MutableRefObject<MotionSnapshot[]>
  audioContextRef: React.MutableRefObject<AudioContext | null>
  oscillatorRef: React.MutableRefObject<OscillatorNode | null>
  gainNodeRef: React.MutableRefObject<GainNode | null>
  motionData: MotionData
  setMotionData: React.Dispatch<React.SetStateAction<MotionData>>
}

const INSTRUMENT_COLORS: Record<InstrumentType, string> = {
  synth: '#a855f7',
  piano: '#3b82f6',
  strings: '#22c55e',
  drums: '#f97316',
}

const INSTRUMENT_LABELS: Record<InstrumentType, string> = {
  synth: 'Synth',
  piano: 'Piano',
  strings: 'Strings',
  drums: 'Drums',
}

const INSTRUMENT_ICONS: Record<InstrumentType, React.ReactNode> = {
  synth: <FaMusic />,
  piano: <FaVolumeUp />,
  strings: <FaGuitar />,
  drums: <FaDrum />,
}

const NOTE_LABELS = ['C3', 'D3', 'E3', 'F3', 'G3', 'A3', 'B3', 'C4']

function isSkinColor(r: number, g: number, b: number): boolean {
  const rule1 = r > 95 && g > 40 && b > 20 &&
    Math.max(r, g, b) - Math.min(r, g, b) > 15 &&
    Math.abs(r - g) > 15 && r > g && r > b
  const rule2 = r > 220 && g > 210 && b > 170 &&
    Math.abs(r - g) <= 15 && r > b && g > b
  return rule1 || rule2
}

interface FingerResult {
  x: number
  y: number
  confidence: number
}

function findFingerPosition(imageData: ImageData, width: number, height: number): FingerResult | null {
  const gridSize = 20
  const cols = Math.floor(width / gridSize)
  const rows = Math.floor(height / gridSize)
  const grid: number[][] = Array.from({ length: rows }, () => Array(cols).fill(0))

  for (let y = 0; y < height; y += 2) {
    for (let x = 0; x < width; x += 2) {
      const i = (y * width + x) * 4
      if (isSkinColor(imageData.data[i], imageData.data[i + 1], imageData.data[i + 2])) {
        const gx = Math.min(Math.floor(x / gridSize), cols - 1)
        const gy = Math.min(Math.floor(y / gridSize), rows - 1)
        grid[gy][gx]++
      }
    }
  }

  let maxCount = 0
  let maxGx = Math.floor(cols / 2)
  let maxGy = Math.floor(rows / 2)
  for (let gy = 0; gy < rows; gy++) {
    for (let gx = 0; gx < cols; gx++) {
      if (grid[gy][gx] > maxCount) {
        maxCount = grid[gy][gx]
        maxGx = gx
        maxGy = gy
      }
    }
  }

  if (maxCount < 3) return null

  return {
    x: (maxGx + 0.5) * gridSize / width,
    y: (maxGy + 0.5) * gridSize / height,
    confidence: Math.min(maxCount / (gridSize * gridSize / 4), 1),
  }
}

function xToFreq(normalizedX: number): number {
  return 130.81 * Math.pow(2, normalizedX * 2)
}

function freqToNote(freq: number): string {
  const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
  const noteNum = 12 * (Math.log2(freq / 440)) + 69
  const note = Math.round(noteNum)
  const octave = Math.floor(note / 12) - 1
  return noteNames[((note % 12) + 12) % 12] + octave
}

export default function CameraSection({
  currentInstrument,
  setCurrentInstrument,
  isPlaying,
  setIsPlaying,
  isRecording,
  recordingRef,
  audioContextRef,
  oscillatorRef,
  gainNodeRef,
  setMotionData,
}: CameraSectionProps) {
  const [cameraActive, setCameraActive] = useState(false)
  const [fingerPos, setFingerPos] = useState<FingerResult | null>(null)
  const [currentFreq, setCurrentFreq] = useState(261.63)
  const [currentGain, setCurrentGain] = useState(0.5)
  const [cameraError, setCameraError] = useState<string | null>(null)

  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const overlayRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const animFrameRef = useRef<number>(0)
  const prevYRef = useRef<number | null>(null)
  const prevTimeRef = useRef<number>(0)
  const filterRef = useRef<BiquadFilterNode | null>(null)

  const accentColor = INSTRUMENT_COLORS[currentInstrument]

  const initAudio = useCallback(() => {
    if (audioContextRef.current) return
    const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)()
    audioContextRef.current = ctx
    const gain = ctx.createGain()
    gain.gain.value = 0
    gain.connect(ctx.destination)
    gainNodeRef.current = gain
  }, [audioContextRef, gainNodeRef])

  const startSound = useCallback(() => {
    if (!audioContextRef.current || !gainNodeRef.current) return
    if (oscillatorRef.current) {
      try { oscillatorRef.current.stop() } catch (_e) { /* ignore */ }
    }
    const ctx = audioContextRef.current
    const osc = ctx.createOscillator()

    if (currentInstrument === 'synth') {
      osc.type = 'sawtooth'
      osc.connect(gainNodeRef.current)
    } else if (currentInstrument === 'piano') {
      osc.type = 'triangle'
      osc.connect(gainNodeRef.current)
    } else if (currentInstrument === 'strings') {
      osc.type = 'sine'
      const filter = ctx.createBiquadFilter()
      filter.type = 'lowpass'
      filter.frequency.value = 800
      filter.Q.value = 2
      osc.connect(filter)
      filter.connect(gainNodeRef.current)
      filterRef.current = filter
    } else {
      osc.type = 'square'
      osc.connect(gainNodeRef.current)
    }
    osc.start()
    oscillatorRef.current = osc
    setIsPlaying(true)
  }, [audioContextRef, gainNodeRef, oscillatorRef, currentInstrument, setIsPlaying])

  const stopSound = useCallback(() => {
    if (oscillatorRef.current) {
      try { oscillatorRef.current.stop() } catch (_e) { /* ignore */ }
      oscillatorRef.current = null
    }
    if (gainNodeRef.current) {
      gainNodeRef.current.gain.value = 0
    }
    setIsPlaying(false)
  }, [oscillatorRef, gainNodeRef, setIsPlaying])

  const triggerPercussion = useCallback(() => {
    if (!audioContextRef.current) return
    const ctx = audioContextRef.current
    const bufferSize = ctx.sampleRate * 0.1
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate)
    const data = buffer.getChannelData(0)
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / bufferSize, 3)
    }
    const source = ctx.createBufferSource()
    source.buffer = buffer
    const percGain = ctx.createGain()
    percGain.gain.value = 0.5
    source.connect(percGain)
    percGain.connect(ctx.destination)
    source.start()
  }, [audioContextRef])

  const processFrame = useCallback(() => {
    if (!videoRef.current || !canvasRef.current || !overlayRef.current) return
    const video = videoRef.current
    const canvas = canvasRef.current
    const overlay = overlayRef.current
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    const oCtx = overlay.getContext('2d')
    if (!ctx || !oCtx) return

    canvas.width = 640
    canvas.height = 480
    overlay.width = 640
    overlay.height = 480

    ctx.drawImage(video, 0, 0, 640, 480)
    const imageData = ctx.getImageData(0, 0, 640, 480)
    const finger = findFingerPosition(imageData, 640, 480)

    oCtx.clearRect(0, 0, 640, 480)

    // Draw pitch guide lines (horizontal divisions for notes)
    oCtx.strokeStyle = 'rgba(255,255,255,0.08)'
    oCtx.lineWidth = 1
    oCtx.font = '10px monospace'
    oCtx.fillStyle = 'rgba(255,255,255,0.25)'
    for (let i = 0; i < NOTE_LABELS.length; i++) {
      const xPos = (i / (NOTE_LABELS.length - 1)) * 640
      oCtx.beginPath()
      oCtx.moveTo(xPos, 0)
      oCtx.lineTo(xPos, 480)
      oCtx.stroke()
      oCtx.fillText(NOTE_LABELS[i], xPos + 3, 14)
    }

    // Draw volume guide labels
    oCtx.fillStyle = 'rgba(255,255,255,0.2)'
    oCtx.font = '10px monospace'
    oCtx.fillText('LOUD', 4, 28)
    oCtx.fillText('QUIET', 4, 474)

    // Draw percussion zone
    oCtx.fillStyle = 'rgba(249,115,22,0.08)'
    oCtx.fillRect(0, 400, 640, 80)
    oCtx.fillStyle = 'rgba(249,115,22,0.3)'
    oCtx.font = '10px monospace'
    oCtx.fillText('PERCUSSION ZONE', 260, 445)

    if (finger) {
      setFingerPos(finger)
      const freq = xToFreq(finger.x)
      const gain = 1 - finger.y
      setCurrentFreq(freq)
      setCurrentGain(gain)

      // Update shared motion data so recorder captures camera input too
      const betaEquivalent = (finger.x * 180) - 90
      const gammaEquivalent = (gain * 180) - 90
      setMotionData(prev => ({
        ...prev,
        beta: betaEquivalent,
        gamma: gammaEquivalent,
      }))

      // Update audio
      if (oscillatorRef.current && gainNodeRef.current && audioContextRef.current) {
        oscillatorRef.current.frequency.setValueAtTime(freq, audioContextRef.current.currentTime)
        gainNodeRef.current.gain.setValueAtTime(Math.max(0, Math.min(1, gain)), audioContextRef.current.currentTime)
      }

      // Check for rapid downward movement (percussion trigger)
      const now = performance.now()
      if (prevYRef.current !== null && prevTimeRef.current > 0) {
        const dy = finger.y - prevYRef.current
        const dt = now - prevTimeRef.current
        if (dy > 0.3 && dt < 150) {
          triggerPercussion()
        }
      }
      prevYRef.current = finger.y
      prevTimeRef.current = now

      // Record if active
      if (isRecording) {
        recordingRef.current.push({
          timestamp: Date.now(),
          beta: betaEquivalent,
          gamma: gammaEquivalent,
          acceleration: 0,
          instrument: currentInstrument,
        })
      }

      // Draw finger indicator - glowing circle
      const px = finger.x * 640
      const py = finger.y * 480
      const gradient = oCtx.createRadialGradient(px, py, 0, px, py, 30)
      gradient.addColorStop(0, accentColor + 'cc')
      gradient.addColorStop(0.5, accentColor + '44')
      gradient.addColorStop(1, 'transparent')
      oCtx.fillStyle = gradient
      oCtx.beginPath()
      oCtx.arc(px, py, 30, 0, Math.PI * 2)
      oCtx.fill()

      // Inner crosshair
      oCtx.strokeStyle = accentColor
      oCtx.lineWidth = 2
      oCtx.beginPath()
      oCtx.arc(px, py, 12, 0, Math.PI * 2)
      oCtx.stroke()
      oCtx.beginPath()
      oCtx.moveTo(px - 18, py)
      oCtx.lineTo(px - 8, py)
      oCtx.moveTo(px + 8, py)
      oCtx.lineTo(px + 18, py)
      oCtx.moveTo(px, py - 18)
      oCtx.lineTo(px, py - 8)
      oCtx.moveTo(px, py + 8)
      oCtx.lineTo(px, py + 18)
      oCtx.stroke()

      // Coordinate label
      oCtx.fillStyle = 'white'
      oCtx.font = 'bold 11px monospace'
      oCtx.fillText(`${freqToNote(freq)} ${Math.round(freq)}Hz`, px + 20, py - 8)
      oCtx.fillStyle = 'rgba(255,255,255,0.6)'
      oCtx.font = '10px monospace'
      oCtx.fillText(`Vol: ${Math.round(gain * 100)}%`, px + 20, py + 6)
    } else {
      setFingerPos(null)
      prevYRef.current = null
    }

    animFrameRef.current = requestAnimationFrame(processFrame)
  }, [accentColor, audioContextRef, oscillatorRef, gainNodeRef, triggerPercussion, isRecording, recordingRef, currentInstrument, setMotionData])

  const startCamera = useCallback(async () => {
    setCameraError(null)
    initAudio()
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: 640, height: 480 },
      })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        videoRef.current.onloadedmetadata = () => {
          videoRef.current?.play()
          setCameraActive(true)
          animFrameRef.current = requestAnimationFrame(processFrame)
        }
      }
    } catch (err) {
      setCameraError(err instanceof Error ? err.message : 'Failed to access camera')
    }
  }, [initAudio, processFrame])

  const stopCamera = useCallback(() => {
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current)
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop())
      streamRef.current = null
    }
    setCameraActive(false)
    setFingerPos(null)
    stopSound()
  }, [stopSound])

  useEffect(() => {
    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current)
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop())
      }
    }
  }, [])

  const currentNote = freqToNote(currentFreq)

  return (
    <div className="flex flex-col items-center gap-4 px-4 pb-24 pt-4">
      {/* Instrument Selector */}
      <div className="flex gap-2 w-full max-w-md">
        {(['synth', 'piano', 'strings', 'drums'] as InstrumentType[]).map((inst) => (
          <button
            key={inst}
            onClick={() => {
              setCurrentInstrument(inst)
              if (isPlaying) stopSound()
            }}
            className="flex-1 flex flex-col items-center gap-1 py-3 px-2 rounded-xl transition-all duration-200"
            style={{
              background: currentInstrument === inst ? `${INSTRUMENT_COLORS[inst]}22` : 'rgba(255,255,255,0.05)',
              border: `1px solid ${currentInstrument === inst ? INSTRUMENT_COLORS[inst] : 'rgba(255,255,255,0.1)'}`,
              color: currentInstrument === inst ? INSTRUMENT_COLORS[inst] : '#9ca3af',
            }}
          >
            <span className="text-lg">{INSTRUMENT_ICONS[inst]}</span>
            <span className="text-xs font-medium">{INSTRUMENT_LABELS[inst]}</span>
          </button>
        ))}
      </div>

      {/* Camera View */}
      <div className="relative w-full max-w-md overflow-hidden rounded-2xl" style={{ border: `1px solid ${accentColor}33`, background: 'rgba(0,0,0,0.5)' }}>
        <div className="relative" style={{ aspectRatio: '4/3' }}>
          <video
            ref={videoRef}
            playsInline
            muted
            className="absolute inset-0 w-full h-full object-cover"
            style={{ display: cameraActive ? 'block' : 'none', transform: 'scaleX(-1)' }}
          />
          <canvas ref={canvasRef} className="hidden" width={640} height={480} />
          <canvas
            ref={overlayRef}
            className="absolute inset-0 w-full h-full"
            width={640}
            height={480}
            style={{ display: cameraActive ? 'block' : 'none', transform: 'scaleX(-1)' }}
          />

          {/* Camera Off State */}
          {!cameraActive && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
              <div className="w-16 h-16 rounded-full flex items-center justify-center" style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)' }}>
                <FaVideo className="text-2xl text-gray-500" />
              </div>
              <p className="text-sm text-gray-500 text-center max-w-[200px]">Enable camera to track finger position and play music</p>
            </div>
          )}

          {/* Finger detected indicator */}
          {cameraActive && (
            <div className="absolute top-3 right-3 z-10">
              <Badge
                className="text-xs border-0 font-medium"
                style={{
                  background: fingerPos ? 'rgba(34,197,94,0.2)' : 'rgba(239,68,68,0.2)',
                  color: fingerPos ? '#22c55e' : '#ef4444',
                }}
              >
                <FaHandPaper className="mr-1" />
                {fingerPos ? 'Tracking' : 'No finger'}
              </Badge>
            </div>
          )}
        </div>
      </div>

      {/* Camera Error */}
      {cameraError && (
        <div className="w-full max-w-md text-center px-4 py-3 rounded-xl" style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)' }}>
          <p className="text-sm text-red-400">{cameraError}</p>
        </div>
      )}

      {/* Camera Controls */}
      <div className="flex gap-3 w-full max-w-md">
        <Button
          onClick={cameraActive ? stopCamera : startCamera}
          className="flex-1 py-5 text-base font-semibold rounded-xl flex items-center justify-center gap-2"
          style={{
            background: cameraActive ? 'rgba(239,68,68,0.8)' : accentColor,
          }}
        >
          {cameraActive ? <FaVideoSlash /> : <FaVideo />}
          {cameraActive ? 'Stop Camera' : 'Start Camera'}
        </Button>
        {cameraActive && (
          <Button
            onClick={() => {
              initAudio()
              if (isPlaying) stopSound()
              else startSound()
            }}
            className="py-5 px-6 text-base font-semibold rounded-xl"
            style={{
              background: isPlaying ? 'rgba(239,68,68,0.8)' : 'rgba(255,255,255,0.1)',
              border: `1px solid ${isPlaying ? 'rgba(239,68,68,0.5)' : 'rgba(255,255,255,0.15)'}`,
            }}
          >
            {isPlaying ? 'Mute' : 'Sound On'}
          </Button>
        )}
      </div>

      {/* Note Display */}
      {cameraActive && fingerPos && (
        <div className="flex items-center gap-4 w-full max-w-md justify-center">
          <div className="text-center">
            <div className="text-4xl font-bold" style={{ color: accentColor }}>{currentNote}</div>
            <div className="text-xs text-gray-500 mt-1">{Math.round(currentFreq)} Hz</div>
          </div>
          <div className="w-px h-12" style={{ background: 'rgba(255,255,255,0.1)' }} />
          <div className="text-center">
            <div className="text-2xl font-bold text-white">{Math.round(currentGain * 100)}%</div>
            <div className="text-xs text-gray-500 mt-1">Volume</div>
          </div>
        </div>
      )}

      {/* Telemetry */}
      <Card className="w-full max-w-md border-0" style={{ background: 'rgba(255,255,255,0.05)', backdropFilter: 'blur(12px)' }}>
        <CardContent className="p-4">
          <div className="text-xs text-gray-500 uppercase tracking-wider mb-3 font-semibold">Camera Tracking Data</div>
          <div className="grid grid-cols-3 gap-3">
            <div className="p-3 rounded-lg" style={{ background: 'rgba(255,255,255,0.05)' }}>
              <div className="text-xs text-gray-500">Finger X</div>
              <div className="text-lg font-mono text-white">{fingerPos ? (fingerPos.x * 100).toFixed(0) + '%' : '--'}</div>
              <div className="mt-1 h-1 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.1)' }}>
                <div className="h-full rounded-full transition-all" style={{ width: fingerPos ? `${fingerPos.x * 100}%` : '0%', background: accentColor }} />
              </div>
            </div>
            <div className="p-3 rounded-lg" style={{ background: 'rgba(255,255,255,0.05)' }}>
              <div className="text-xs text-gray-500">Finger Y</div>
              <div className="text-lg font-mono text-white">{fingerPos ? (fingerPos.y * 100).toFixed(0) + '%' : '--'}</div>
              <div className="mt-1 h-1 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.1)' }}>
                <div className="h-full rounded-full transition-all" style={{ width: fingerPos ? `${fingerPos.y * 100}%` : '0%', background: accentColor }} />
              </div>
            </div>
            <div className="p-3 rounded-lg" style={{ background: 'rgba(255,255,255,0.05)' }}>
              <div className="text-xs text-gray-500">Confidence</div>
              <div className="text-lg font-mono text-white">{fingerPos ? (fingerPos.confidence * 100).toFixed(0) + '%' : '--'}</div>
              <div className="mt-1 h-1 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.1)' }}>
                <div className="h-full rounded-full transition-all" style={{ width: fingerPos ? `${fingerPos.confidence * 100}%` : '0%', background: fingerPos && fingerPos.confidence > 0.5 ? '#22c55e' : '#f97316' }} />
              </div>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3 mt-3">
            <div className="p-3 rounded-lg" style={{ background: 'rgba(255,255,255,0.05)' }}>
              <div className="text-xs text-gray-500">Frequency</div>
              <div className="text-sm font-mono text-white">{fingerPos ? Math.round(currentFreq) + ' Hz' : '--'}</div>
            </div>
            <div className="p-3 rounded-lg" style={{ background: 'rgba(255,255,255,0.05)' }}>
              <div className="text-xs text-gray-500">Note</div>
              <div className="text-sm font-mono" style={{ color: fingerPos ? accentColor : '#6b7280' }}>{fingerPos ? currentNote : '--'}</div>
            </div>
            <div className="p-3 rounded-lg" style={{ background: 'rgba(255,255,255,0.05)' }}>
              <div className="text-xs text-gray-500">Volume</div>
              <div className="text-sm font-mono text-white">{fingerPos ? Math.round(currentGain * 100) + '%' : '--'}</div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Status */}
      <div className="flex items-center gap-2 text-xs text-gray-500">
        <div className="w-2 h-2 rounded-full" style={{ background: cameraActive ? '#22c55e' : '#ef4444' }} />
        {cameraActive ? 'Camera active' : 'Camera inactive'}
        {fingerPos && (
          <>
            <div className="w-1 h-1 rounded-full bg-gray-600" />
            <span style={{ color: accentColor }}>Playing {INSTRUMENT_LABELS[currentInstrument]}</span>
          </>
        )}
        {isPlaying && (
          <>
            <div className="w-1 h-1 rounded-full bg-gray-600" />
            <span className="text-green-400">Sound ON</span>
          </>
        )}
      </div>
    </div>
  )
}

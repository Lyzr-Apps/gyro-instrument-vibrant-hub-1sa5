'use client'

import React, { useState, useRef, useEffect, useCallback } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { FaVideo, FaVideoSlash, FaMusic, FaGuitar, FaDrum, FaVolumeUp, FaVolumeMute, FaHandPaper, FaCrosshairs, FaCircle } from 'react-icons/fa'
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

    // --- Scan lines (subtle green) ---
    for (let i = 0; i < 480; i += 20) {
      oCtx.strokeStyle = 'rgba(0, 255, 0, 0.03)'
      oCtx.lineWidth = 1
      oCtx.beginPath()
      oCtx.moveTo(0, i)
      oCtx.lineTo(640, i)
      oCtx.stroke()
    }

    // --- Corner brackets (targeting reticle, green) ---
    oCtx.strokeStyle = '#00ff00'
    oCtx.lineWidth = 2
    const margin = 15
    oCtx.beginPath()
    oCtx.moveTo(margin, margin + 30)
    oCtx.lineTo(margin, margin)
    oCtx.lineTo(margin + 30, margin)
    oCtx.stroke()
    oCtx.beginPath()
    oCtx.moveTo(640 - margin - 30, margin)
    oCtx.lineTo(640 - margin, margin)
    oCtx.lineTo(640 - margin, margin + 30)
    oCtx.stroke()
    oCtx.beginPath()
    oCtx.moveTo(margin, 480 - margin - 30)
    oCtx.lineTo(margin, 480 - margin)
    oCtx.lineTo(margin + 30, 480 - margin)
    oCtx.stroke()
    oCtx.beginPath()
    oCtx.moveTo(640 - margin - 30, 480 - margin)
    oCtx.lineTo(640 - margin, 480 - margin)
    oCtx.lineTo(640 - margin, 480 - margin - 30)
    oCtx.stroke()

    // --- Pitch guide lines (cyan vertical guides with note labels) ---
    oCtx.font = 'bold 10px monospace'
    for (let i = 0; i < NOTE_LABELS.length; i++) {
      const xPos = (i / (NOTE_LABELS.length - 1)) * 640
      oCtx.strokeStyle = 'rgba(0, 255, 255, 0.08)'
      oCtx.lineWidth = 1
      oCtx.beginPath()
      oCtx.moveTo(xPos, 0)
      oCtx.lineTo(xPos, 480)
      oCtx.stroke()
      oCtx.fillStyle = 'rgba(0, 255, 255, 0.4)'
      oCtx.fillText(NOTE_LABELS[i], xPos + 3, 14)
    }

    // --- Volume guide labels ---
    oCtx.fillStyle = 'rgba(0, 255, 255, 0.25)'
    oCtx.font = 'bold 10px monospace'
    oCtx.fillText('LOUD', 4, 28)
    oCtx.fillText('QUIET', 4, 474)

    // --- Percussion zone ---
    oCtx.fillStyle = 'rgba(249,115,22,0.08)'
    oCtx.fillRect(0, 400, 640, 80)
    oCtx.fillStyle = 'rgba(249,115,22,0.35)'
    oCtx.font = 'bold 10px monospace'
    oCtx.fillText('PERCUSSION ZONE', 260, 445)

    if (finger) {
      setFingerPos(finger)
      const freq = xToFreq(finger.x)
      const gain = 1 - finger.y
      setCurrentFreq(freq)
      setCurrentGain(gain)

      const noteName = freqToNote(freq)

      // Update shared motion data
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

      // --- Enhanced neon overlay drawing ---
      const px = finger.x * 640
      const py = finger.y * 480

      // Hand skeleton: green lines from palm center to fingertips
      const palmX = px
      const palmY = py + 60
      const fingerEndpoints = [
        { x: px - 40, y: py - 50 },
        { x: px - 15, y: py - 60 },
        { x: px, y: py - 65 },
        { x: px + 15, y: py - 55 },
        { x: px + 30, y: py - 45 },
      ]

      // Green skeletal lines
      oCtx.strokeStyle = '#00ff00'
      oCtx.lineWidth = 2
      fingerEndpoints.forEach(ep => {
        oCtx.beginPath()
        oCtx.moveTo(palmX, palmY)
        oCtx.lineTo(ep.x, ep.y)
        oCtx.stroke()
      })

      // Connect fingertips with a faint green line
      oCtx.strokeStyle = 'rgba(0, 255, 0, 0.4)'
      oCtx.lineWidth = 1
      oCtx.beginPath()
      oCtx.moveTo(fingerEndpoints[0].x, fingerEndpoints[0].y)
      for (let fe = 1; fe < fingerEndpoints.length; fe++) {
        oCtx.lineTo(fingerEndpoints[fe].x, fingerEndpoints[fe].y)
      }
      oCtx.stroke()

      // Red joint dots at fingertips, midpoints, and palm
      oCtx.fillStyle = '#ff0000'
      fingerEndpoints.forEach(ep => {
        oCtx.beginPath()
        oCtx.arc(ep.x, ep.y, 4, 0, Math.PI * 2)
        oCtx.fill()
        const midX = (palmX + ep.x) / 2
        const midY = (palmY + ep.y) / 2
        oCtx.beginPath()
        oCtx.arc(midX, midY, 3, 0, Math.PI * 2)
        oCtx.fill()
      })

      // Palm center dot (larger, red)
      oCtx.beginPath()
      oCtx.arc(palmX, palmY, 6, 0, Math.PI * 2)
      oCtx.fill()

      // Glowing cyan circle around primary tracking point
      const gradient = oCtx.createRadialGradient(px, py, 0, px, py, 25)
      gradient.addColorStop(0, 'rgba(0, 255, 255, 0.8)')
      gradient.addColorStop(0.5, 'rgba(0, 255, 255, 0.2)')
      gradient.addColorStop(1, 'transparent')
      oCtx.fillStyle = gradient
      oCtx.beginPath()
      oCtx.arc(px, py, 25, 0, Math.PI * 2)
      oCtx.fill()

      // Crosshair at finger position (cyan)
      oCtx.strokeStyle = '#00ffff'
      oCtx.lineWidth = 1.5
      oCtx.beginPath()
      oCtx.moveTo(px - 30, py)
      oCtx.lineTo(px - 10, py)
      oCtx.moveTo(px + 10, py)
      oCtx.lineTo(px + 30, py)
      oCtx.moveTo(px, py - 30)
      oCtx.lineTo(px, py - 10)
      oCtx.moveTo(px, py + 10)
      oCtx.lineTo(px, py + 30)
      oCtx.stroke()

      // Info text near finger
      oCtx.fillStyle = '#00ffff'
      oCtx.font = 'bold 12px monospace'
      oCtx.fillText(`${noteName} | ${Math.round(freq)}Hz`, px + 35, py - 5)
      oCtx.fillStyle = '#ff1493'
      oCtx.font = '11px monospace'
      oCtx.fillText(`VOL: ${Math.round(gain * 100)}%`, px + 35, py + 12)
    } else {
      setFingerPos(null)
      prevYRef.current = null
    }

    animFrameRef.current = requestAnimationFrame(processFrame)
  }, [audioContextRef, oscillatorRef, gainNodeRef, triggerPercussion, isRecording, recordingRef, currentInstrument, setMotionData])

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
  const volumePercent = Math.round(currentGain * 100)

  return (
    <div className="flex flex-col items-center gap-5 px-4 pb-24 pt-4" style={{ background: '#000000' }}>
      {/* Header Area */}
      <div className="flex flex-col items-center gap-2 w-full max-w-2xl">
        <Badge className="text-xs font-bold tracking-widest border-0 px-4 py-1" style={{ background: '#ff1493', color: '#ffffff' }}>
          GESTURE INSTRUMENT
        </Badge>
        <div className="text-center mt-1">
          <h1 className="text-4xl font-black tracking-tight text-white leading-none">GESTURE</h1>
          <h1 className="text-4xl font-black tracking-tight text-white leading-none">VOLUME</h1>
          <span className="text-lg font-bold tracking-wide" style={{ color: '#FFD700' }}>{'& PITCH'}</span>
        </div>
        <p className="text-sm font-medium tracking-wide" style={{ color: '#00FFFF' }}>Control music with your fingers</p>
        <Badge className="text-[10px] border-0 font-mono px-2 py-0.5 mt-1" style={{ background: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.5)' }}>
          OpenCV + Web Audio
        </Badge>
      </div>

      {/* Instrument Selector (neon glow on selected) */}
      <div className="flex gap-2 w-full max-w-2xl">
        {(['synth', 'piano', 'strings', 'drums'] as InstrumentType[]).map((inst) => {
          const isSelected = currentInstrument === inst
          return (
            <button
              key={inst}
              onClick={() => {
                setCurrentInstrument(inst)
                if (isPlaying) stopSound()
              }}
              className="flex-1 flex flex-col items-center gap-1 py-3 px-2 rounded-xl transition-all duration-200"
              style={{
                background: isSelected ? `${INSTRUMENT_COLORS[inst]}18` : 'rgba(255,255,255,0.03)',
                border: `1px solid ${isSelected ? INSTRUMENT_COLORS[inst] : 'rgba(255,255,255,0.08)'}`,
                color: isSelected ? INSTRUMENT_COLORS[inst] : '#6b7280',
                boxShadow: isSelected ? `0 0 15px ${INSTRUMENT_COLORS[inst]}40, inset 0 0 15px ${INSTRUMENT_COLORS[inst]}10` : 'none',
              }}
            >
              <span className="text-lg">{INSTRUMENT_ICONS[inst]}</span>
              <span className="text-xs font-semibold tracking-wide">{INSTRUMENT_LABELS[inst]}</span>
            </button>
          )
        })}
      </div>

      {/* Main Layout: Volume Bar (left) + Camera (right) */}
      <div className="flex gap-4 w-full max-w-2xl items-stretch">
        {/* Left: Volume Indicator + Note Display */}
        <div className="flex flex-col items-center gap-3 w-20 shrink-0">
          {/* Speaker icon (top = loud) */}
          <FaVolumeUp className="text-lg" style={{ color: fingerPos && currentGain > 0.05 ? '#ef4444' : '#4b5563' }} />

          {/* Vertical volume bar */}
          <div className="relative flex-1 w-6 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.1)', minHeight: 200 }}>
            <div
              className="absolute bottom-0 left-0 right-0 rounded-full transition-all duration-150"
              style={{
                height: fingerPos ? `${volumePercent}%` : '0%',
                background: 'linear-gradient(to top, #ef4444, #f97316, #eab308)',
              }}
            />
            {/* Level tick marks */}
            {[25, 50, 75].map(tick => (
              <div
                key={tick}
                className="absolute left-0 right-0 h-px"
                style={{ bottom: `${tick}%`, background: 'rgba(255,255,255,0.15)' }}
              />
            ))}
          </div>

          {/* Muted icon (bottom = quiet) */}
          <FaVolumeMute className="text-lg" style={{ color: !fingerPos || currentGain < 0.05 ? '#ef4444' : '#4b5563' }} />

          {/* Volume percentage */}
          <div className="text-center">
            <div className="text-lg font-bold font-mono text-white">{fingerPos ? `${volumePercent}%` : '--'}</div>
            <div className="text-[10px] font-semibold tracking-widest" style={{ color: '#ff1493' }}>VOL</div>
          </div>

          {/* Current note info */}
          <div className="text-center mt-1">
            <div className="text-2xl font-black font-mono" style={{ color: fingerPos ? accentColor : '#4b5563' }}>
              {fingerPos ? currentNote : '--'}
            </div>
            <div className="text-[10px] font-mono" style={{ color: '#00FFFF' }}>
              {fingerPos ? `${Math.round(currentFreq)} Hz` : '-- Hz'}
            </div>
          </div>
        </div>

        {/* Right: Camera Feed */}
        <div className="relative flex-1 overflow-hidden rounded-xl" style={{ border: '1px solid rgba(0,255,0,0.2)', background: '#0a0a0a' }}>
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
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3" style={{ background: '#0a0a0a' }}>
                <div className="w-16 h-16 rounded-full flex items-center justify-center" style={{ background: 'rgba(0,255,0,0.05)', border: '1px solid rgba(0,255,0,0.15)' }}>
                  <FaVideo className="text-2xl" style={{ color: '#00ff00' }} />
                </div>
                <p className="text-sm text-center max-w-[220px]" style={{ color: '#00FFFF' }}>
                  Enable camera to track finger position and control music
                </p>
                <div className="flex items-center gap-1 text-[10px]" style={{ color: 'rgba(255,255,255,0.3)' }}>
                  <FaCrosshairs className="text-[8px]" />
                  <span>Skin-tone detection via OpenCV algorithms</span>
                </div>
              </div>
            )}

            {/* Tracking status badge */}
            {cameraActive && (
              <div className="absolute top-3 right-3 z-10">
                <Badge
                  className="text-[10px] border-0 font-bold tracking-wider"
                  style={{
                    background: fingerPos ? 'rgba(0,255,0,0.15)' : 'rgba(255,0,0,0.15)',
                    color: fingerPos ? '#00ff00' : '#ff0000',
                    border: `1px solid ${fingerPos ? 'rgba(0,255,0,0.3)' : 'rgba(255,0,0,0.3)'}`,
                  }}
                >
                  <FaHandPaper className="mr-1" />
                  {fingerPos ? 'TRACKING' : 'NO SIGNAL'}
                </Badge>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Camera Error */}
      {cameraError && (
        <div className="w-full max-w-2xl text-center px-4 py-3 rounded-xl" style={{ background: 'rgba(255,0,0,0.08)', border: '1px solid rgba(255,0,0,0.2)' }}>
          <p className="text-sm" style={{ color: '#ff4444' }}>{cameraError}</p>
        </div>
      )}

      {/* Controls */}
      <div className="flex gap-3 w-full max-w-2xl">
        <Button
          onClick={cameraActive ? stopCamera : startCamera}
          className="flex-1 py-5 text-base font-bold rounded-xl flex items-center justify-center gap-2 border-0 transition-all duration-300"
          style={{
            background: cameraActive ? 'rgba(255,0,0,0.7)' : 'linear-gradient(135deg, #ff1493, #00FFFF)',
            color: '#ffffff',
            boxShadow: cameraActive ? '0 0 20px rgba(255,0,0,0.3)' : '0 0 20px rgba(255,20,147,0.3)',
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
            className="py-5 px-6 text-base font-bold rounded-xl border-0 transition-all duration-300"
            style={{
              background: isPlaying ? 'rgba(0,255,0,0.15)' : 'rgba(255,0,0,0.15)',
              color: isPlaying ? '#00ff00' : '#ff4444',
              border: `1px solid ${isPlaying ? 'rgba(0,255,0,0.3)' : 'rgba(255,0,0,0.3)'}`,
              boxShadow: isPlaying ? '0 0 15px rgba(0,255,0,0.15)' : 'none',
            }}
          >
            {isPlaying ? <><FaVolumeUp className="mr-2" /> Sound ON</> : <><FaVolumeMute className="mr-2" /> Sound OFF</>}
          </Button>
        )}
      </div>

      {/* Telemetry Panel */}
      <Card className="w-full max-w-2xl border-0 rounded-xl overflow-hidden" style={{ background: '#0a0a0a', border: '1px solid rgba(255,20,147,0.2)' }}>
        <CardContent className="p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="text-xs font-bold tracking-[0.2em] uppercase" style={{ color: '#ff1493' }}>
              Telemetry Data
            </div>
            <Badge className="text-[9px] border-0 font-mono" style={{ background: 'rgba(0,255,255,0.1)', color: '#00FFFF' }}>
              LIVE
            </Badge>
          </div>
          <div className="grid grid-cols-3 gap-3">
            {/* Finger X */}
            <div className="p-3 rounded-lg" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(0,255,255,0.1)' }}>
              <div className="text-[10px] font-bold tracking-widest" style={{ color: '#ff1493' }}>FINGER X</div>
              <div className="text-lg font-mono font-bold" style={{ color: '#00FFFF' }}>
                {fingerPos ? (fingerPos.x * 100).toFixed(0) + '%' : '--'}
              </div>
              <div className="mt-1 h-1 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.05)' }}>
                <div className="h-full rounded-full transition-all" style={{ width: fingerPos ? `${fingerPos.x * 100}%` : '0%', background: '#00FFFF' }} />
              </div>
            </div>
            {/* Finger Y */}
            <div className="p-3 rounded-lg" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(0,255,255,0.1)' }}>
              <div className="text-[10px] font-bold tracking-widest" style={{ color: '#ff1493' }}>FINGER Y</div>
              <div className="text-lg font-mono font-bold" style={{ color: '#00FFFF' }}>
                {fingerPos ? (fingerPos.y * 100).toFixed(0) + '%' : '--'}
              </div>
              <div className="mt-1 h-1 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.05)' }}>
                <div className="h-full rounded-full transition-all" style={{ width: fingerPos ? `${fingerPos.y * 100}%` : '0%', background: '#00FFFF' }} />
              </div>
            </div>
            {/* Confidence */}
            <div className="p-3 rounded-lg" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(0,255,0,0.1)' }}>
              <div className="text-[10px] font-bold tracking-widest" style={{ color: '#ff1493' }}>CONFIDENCE</div>
              <div className="text-lg font-mono font-bold" style={{ color: fingerPos && fingerPos.confidence > 0.5 ? '#00ff00' : '#f97316' }}>
                {fingerPos ? (fingerPos.confidence * 100).toFixed(0) + '%' : '--'}
              </div>
              <div className="mt-1 h-1 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.05)' }}>
                <div className="h-full rounded-full transition-all" style={{ width: fingerPos ? `${fingerPos.confidence * 100}%` : '0%', background: fingerPos && fingerPos.confidence > 0.5 ? '#00ff00' : '#f97316' }} />
              </div>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3 mt-3">
            {/* Note */}
            <div className="p-3 rounded-lg" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,20,147,0.1)' }}>
              <div className="text-[10px] font-bold tracking-widest" style={{ color: '#ff1493' }}>NOTE</div>
              <div className="text-sm font-mono font-bold" style={{ color: fingerPos ? accentColor : '#4b5563' }}>
                {fingerPos ? currentNote : '--'}
              </div>
            </div>
            {/* Frequency */}
            <div className="p-3 rounded-lg" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,20,147,0.1)' }}>
              <div className="text-[10px] font-bold tracking-widest" style={{ color: '#ff1493' }}>FREQUENCY</div>
              <div className="text-sm font-mono font-bold" style={{ color: '#00FFFF' }}>
                {fingerPos ? Math.round(currentFreq) + ' Hz' : '--'}
              </div>
            </div>
            {/* Volume */}
            <div className="p-3 rounded-lg" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,20,147,0.1)' }}>
              <div className="text-[10px] font-bold tracking-widest" style={{ color: '#ff1493' }}>VOLUME</div>
              <div className="text-sm font-mono font-bold" style={{ color: '#00FFFF' }}>
                {fingerPos ? volumePercent + '%' : '--'}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Status Bar */}
      <div className="flex items-center gap-3 text-xs font-mono">
        <div className="flex items-center gap-1.5">
          <FaCircle className="text-[6px]" style={{ color: cameraActive ? '#00ff00' : '#ff0000' }} />
          <span style={{ color: cameraActive ? '#00ff00' : '#ff0000' }}>
            {cameraActive ? 'Camera active' : 'Camera inactive'}
          </span>
        </div>
        {fingerPos && (
          <>
            <span style={{ color: 'rgba(255,255,255,0.2)' }}>|</span>
            <span style={{ color: '#ff1493' }}>
              Playing {INSTRUMENT_LABELS[currentInstrument]}
            </span>
          </>
        )}
        {isPlaying && (
          <>
            <span style={{ color: 'rgba(255,255,255,0.2)' }}>|</span>
            <span style={{ color: '#00ff00' }}>Sound ON</span>
          </>
        )}
      </div>
    </div>
  )
}

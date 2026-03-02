'use client'

import React, { useState, useRef, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { FaVideo, FaVideoSlash, FaMusic, FaGuitar, FaDrum, FaVolumeUp, FaVolumeMute, FaHandPaper, FaCrosshairs, FaCircle, FaStop, FaHandRock, FaHandPointUp, FaCompressArrowsAlt, FaExpandArrowsAlt } from 'react-icons/fa'
import type { InstrumentType, MotionData, MotionSnapshot } from './InstrumentSection'
import type { RecordedSession } from './RecorderSection'

interface CameraSectionProps {
  currentInstrument: InstrumentType
  setCurrentInstrument: (i: InstrumentType) => void
  isPlaying: boolean
  setIsPlaying: (v: boolean) => void
  isRecording: boolean
  setIsRecording: (v: boolean) => void
  recordingRef: React.MutableRefObject<MotionSnapshot[]>
  audioContextRef: React.MutableRefObject<AudioContext | null>
  oscillatorRef: React.MutableRefObject<OscillatorNode | null>
  gainNodeRef: React.MutableRefObject<GainNode | null>
  motionData: MotionData
  setMotionData: React.Dispatch<React.SetStateAction<MotionData>>
  sessions: RecordedSession[]
  setSessions: (s: RecordedSession[] | ((prev: RecordedSession[]) => RecordedSession[])) => void
  cameraActive: boolean
  setCameraActive: (v: boolean) => void
}

interface HandRegion {
  x: number
  y: number
  area: number
  isLarge: boolean
}

interface GestureState {
  palmPos: { x: number; y: number } | null
  fingerTip: { x: number; y: number } | null
  spread: number
  velocityX: number
  velocityY: number
  gesture: 'open_hand' | 'point' | 'fist' | 'swipe_down' | 'swipe_up' | 'spread' | 'pinch' | 'none'
  confidence: number
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

const GESTURE_GUIDES: Record<InstrumentType, string> = {
  synth: 'X = Pitch | Y = Filter | Spread = Volume | Swipe = Wah',
  piano: 'X = Note | Tap = Strike | Y = Velocity',
  strings: 'X = Pitch | Spread = Vibrato | Y = Volume',
  drums: 'TL = Hi-hat | TR = Crash | BL = Kick | BR = Snare',
}

const GESTURE_ICON_MAP: Record<string, React.ReactNode> = {
  open_hand: <FaHandPaper />,
  point: <FaHandPointUp />,
  fist: <FaHandRock />,
  spread: <FaExpandArrowsAlt />,
  pinch: <FaCompressArrowsAlt />,
  swipe_down: <FaHandPaper />,
  swipe_up: <FaHandPaper />,
  none: <FaCrosshairs />,
}

function isSkinColor(r: number, g: number, b: number): boolean {
  const rule1 = r > 95 && g > 40 && b > 20 &&
    Math.max(r, g, b) - Math.min(r, g, b) > 15 &&
    Math.abs(r - g) > 15 && r > g && r > b
  const rule2 = r > 220 && g > 210 && b > 170 &&
    Math.abs(r - g) <= 15 && r > b && g > b
  return rule1 || rule2
}

function findHandRegions(imageData: ImageData, width: number, height: number): HandRegion[] {
  const gridSize = 16
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

  const visited: boolean[][] = Array.from({ length: rows }, () => Array(cols).fill(false))
  const regions: HandRegion[] = []
  const threshold = 3

  for (let gy = 0; gy < rows; gy++) {
    for (let gx = 0; gx < cols; gx++) {
      if (grid[gy][gx] >= threshold && !visited[gy][gx]) {
        let totalX = 0, totalY = 0, totalArea = 0, cellCount = 0
        const stack: number[][] = [[gx, gy]]
        while (stack.length > 0) {
          const coords = stack.pop()!
          const cx = coords[0]
          const cy = coords[1]
          if (cx < 0 || cx >= cols || cy < 0 || cy >= rows) continue
          if (visited[cy][cx] || grid[cy][cx] < threshold) continue
          visited[cy][cx] = true
          totalX += cx
          totalY += cy
          totalArea += grid[cy][cx]
          cellCount++
          stack.push([cx - 1, cy], [cx + 1, cy], [cx, cy - 1], [cx, cy + 1])
        }
        if (cellCount >= 2) {
          regions.push({
            x: ((totalX / cellCount) + 0.5) * gridSize / width,
            y: ((totalY / cellCount) + 0.5) * gridSize / height,
            area: totalArea,
            isLarge: cellCount > 8,
          })
        }
      }
    }
  }

  regions.sort((a, b) => b.area - a.area)
  return regions.slice(0, 5)
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

function detectGesture(
  regions: HandRegion[],
  prevGesture: GestureState,
  prevPalmPos: { x: number; y: number } | null,
  dt: number
): GestureState {
  if (regions.length === 0) {
    return { palmPos: null, fingerTip: null, spread: 0, velocityX: 0, velocityY: 0, gesture: 'none', confidence: 0 }
  }

  const palm = regions[0]
  const finger = regions.length > 1 ? regions[1] : null

  const vx = prevPalmPos ? (palm.x - prevPalmPos.x) / Math.max(dt, 0.016) : 0
  const vy = prevPalmPos ? (palm.y - prevPalmPos.y) / Math.max(dt, 0.016) : 0

  let spread = 0
  if (finger) {
    spread = Math.sqrt(Math.pow(palm.x - finger.x, 2) + Math.pow(palm.y - finger.y, 2))
  }

  let gesture: GestureState['gesture'] = 'none'
  let confidence = Math.min(palm.area / 50, 1)

  if (vy > 1.5) {
    gesture = 'swipe_down'
    confidence = Math.min(Math.abs(vy) / 3, 1)
  } else if (vy < -1.5) {
    gesture = 'swipe_up'
    confidence = Math.min(Math.abs(vy) / 3, 1)
  } else if (regions.length >= 2 && spread > 0.15) {
    if (spread > (prevGesture.spread + 0.02)) {
      gesture = 'spread'
    } else if (spread < (prevGesture.spread - 0.02)) {
      gesture = 'pinch'
    } else {
      gesture = 'open_hand'
    }
    confidence = Math.min(spread * 3, 1)
  } else if (regions.length === 1 && !palm.isLarge) {
    gesture = 'point'
    confidence = 0.7
  } else if (regions.length === 1 && palm.isLarge) {
    gesture = 'fist'
    confidence = 0.6
  } else {
    gesture = 'open_hand'
    confidence = 0.5
  }

  return {
    palmPos: { x: palm.x, y: palm.y },
    fingerTip: finger ? { x: finger.x, y: finger.y } : null,
    spread,
    velocityX: vx,
    velocityY: vy,
    gesture,
    confidence,
  }
}

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000)
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

export default function CameraSection({
  currentInstrument,
  setCurrentInstrument,
  isPlaying,
  setIsPlaying,
  isRecording,
  setIsRecording,
  recordingRef,
  audioContextRef,
  oscillatorRef,
  gainNodeRef,
  motionData,
  setMotionData,
  sessions,
  setSessions,
  cameraActive,
  setCameraActive,
}: CameraSectionProps) {
  const [gestureState, setGestureState] = useState<GestureState>({
    palmPos: null, fingerTip: null, spread: 0, velocityX: 0, velocityY: 0, gesture: 'none', confidence: 0,
  })
  const [currentFreq, setCurrentFreq] = useState(261.63)
  const [currentGain, setCurrentGain] = useState(0.5)
  const [cameraError, setCameraError] = useState<string | null>(null)
  const [recordingStartTime, setRecordingStartTime] = useState<number>(0)
  const [recordingElapsed, setRecordingElapsed] = useState(0)
  const [lastDrumHit, setLastDrumHit] = useState<string | null>(null)

  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const overlayRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const animFrameRef = useRef<number>(0)
  const prevGestureRef = useRef<GestureState>({
    palmPos: null, fingerTip: null, spread: 0, velocityX: 0, velocityY: 0, gesture: 'none', confidence: 0,
  })
  const prevTimeRef = useRef<number>(0)
  const filterRef = useRef<BiquadFilterNode | null>(null)
  const lastDrumHitRef = useRef<Record<string, number>>({ kick: 0, snare: 0, hihat: 0, crash: 0 })
  const drumFlashRef = useRef<Record<string, number>>({ kick: 0, snare: 0, hihat: 0, crash: 0 })
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

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
      const filter = ctx.createBiquadFilter()
      filter.type = 'lowpass'
      filter.frequency.value = 2000
      filter.Q.value = 5
      osc.connect(filter)
      filter.connect(gainNodeRef.current)
      filterRef.current = filter
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
    filterRef.current = null
    setIsPlaying(false)
  }, [oscillatorRef, gainNodeRef, setIsPlaying])

  const triggerDrumSound = useCallback((drumType: 'kick' | 'snare' | 'hihat' | 'crash') => {
    if (!audioContextRef.current) return
    const now = performance.now()
    if (now - lastDrumHitRef.current[drumType] < 150) return
    lastDrumHitRef.current[drumType] = now
    drumFlashRef.current[drumType] = now
    setLastDrumHit(drumType)

    const ctx = audioContextRef.current
    const ctxNow = ctx.currentTime

    if (drumType === 'kick') {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.setValueAtTime(150, ctxNow)
      osc.frequency.exponentialRampToValueAtTime(0.01, ctxNow + 0.5)
      gain.gain.setValueAtTime(1, ctxNow)
      gain.gain.exponentialRampToValueAtTime(0.01, ctxNow + 0.5)
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start(ctxNow)
      osc.stop(ctxNow + 0.5)
    } else if (drumType === 'snare') {
      const bufferSize = Math.floor(ctx.sampleRate * 0.15)
      const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate)
      const data = buffer.getChannelData(0)
      for (let i = 0; i < bufferSize; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / bufferSize, 2)
      }
      const source = ctx.createBufferSource()
      source.buffer = buffer
      const gain = ctx.createGain()
      gain.gain.setValueAtTime(0.6, ctxNow)
      const filter = ctx.createBiquadFilter()
      filter.type = 'highpass'
      filter.frequency.value = 1000
      source.connect(filter)
      filter.connect(gain)
      gain.connect(ctx.destination)
      source.start(ctxNow)
    } else if (drumType === 'hihat') {
      const bufferSize = Math.floor(ctx.sampleRate * 0.05)
      const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate)
      const data = buffer.getChannelData(0)
      for (let i = 0; i < bufferSize; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / bufferSize, 4)
      }
      const source = ctx.createBufferSource()
      source.buffer = buffer
      const gain = ctx.createGain()
      gain.gain.setValueAtTime(0.3, ctxNow)
      const filter = ctx.createBiquadFilter()
      filter.type = 'highpass'
      filter.frequency.value = 5000
      source.connect(filter)
      filter.connect(gain)
      gain.connect(ctx.destination)
      source.start(ctxNow)
    } else if (drumType === 'crash') {
      const bufferSize = Math.floor(ctx.sampleRate * 0.4)
      const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate)
      const data = buffer.getChannelData(0)
      for (let i = 0; i < bufferSize; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / bufferSize, 1.5)
      }
      const source = ctx.createBufferSource()
      source.buffer = buffer
      const gain = ctx.createGain()
      gain.gain.setValueAtTime(0.4, ctxNow)
      const filter = ctx.createBiquadFilter()
      filter.type = 'bandpass'
      filter.frequency.value = 3000
      filter.Q.value = 0.5
      source.connect(filter)
      filter.connect(gain)
      gain.connect(ctx.destination)
      source.start(ctxNow)
    }
  }, [audioContextRef])

  const handleStartRecording = useCallback(() => {
    recordingRef.current = []
    setRecordingStartTime(Date.now())
    setRecordingElapsed(0)
    setIsRecording(true)
    recordingTimerRef.current = setInterval(() => {
      setRecordingElapsed(Date.now() - Date.now())
    }, 100)
  }, [recordingRef, setIsRecording])

  const handleStopRecording = useCallback(() => {
    setIsRecording(false)
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current)
      recordingTimerRef.current = null
    }
    const snapshots = [...recordingRef.current]
    if (snapshots.length > 0) {
      const duration = Date.now() - recordingStartTime
      const instruments = Array.from(new Set(snapshots.map(s => s.instrument))) as InstrumentType[]
      const newSession: RecordedSession = {
        id: `session_${Date.now()}`,
        startTime: recordingStartTime,
        duration,
        snapshots,
        instruments,
        noteCount: snapshots.length,
      }
      setSessions((prev: RecordedSession[]) => [newSession, ...prev])
    }
    recordingRef.current = []
  }, [recordingRef, recordingStartTime, setIsRecording, setSessions])

  // Recording elapsed timer
  useEffect(() => {
    if (!isRecording) return
    const interval = setInterval(() => {
      setRecordingElapsed(Date.now() - recordingStartTime)
    }, 100)
    return () => clearInterval(interval)
  }, [isRecording, recordingStartTime])

  const processFrame = useCallback(() => {
    if (!videoRef.current || !canvasRef.current || !overlayRef.current) return
    const video = videoRef.current
    const canvas = canvasRef.current
    const overlay = overlayRef.current
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    const oCtx = overlay.getContext('2d')
    if (!ctx || !oCtx) return

    const W = 640
    const H = 480
    canvas.width = W
    canvas.height = H
    overlay.width = W
    overlay.height = H

    ctx.drawImage(video, 0, 0, W, H)
    const imageData = ctx.getImageData(0, 0, W, H)
    const regions = findHandRegions(imageData, W, H)

    const now = performance.now()
    const dt = prevTimeRef.current > 0 ? (now - prevTimeRef.current) / 1000 : 0.033
    prevTimeRef.current = now

    const gesture = detectGesture(regions, prevGestureRef.current, prevGestureRef.current.palmPos, dt)
    prevGestureRef.current = gesture
    setGestureState(gesture)

    oCtx.clearRect(0, 0, W, H)

    // Scan lines
    for (let i = 0; i < H; i += 20) {
      oCtx.strokeStyle = 'rgba(0, 255, 0, 0.03)'
      oCtx.lineWidth = 1
      oCtx.beginPath()
      oCtx.moveTo(0, i)
      oCtx.lineTo(W, i)
      oCtx.stroke()
    }

    // Corner brackets
    oCtx.strokeStyle = '#00ff00'
    oCtx.lineWidth = 2
    const margin = 15
    const bracketLen = 30
    const corners = [
      [margin, margin, margin + bracketLen, margin, margin, margin + bracketLen],
      [W - margin - bracketLen, margin, W - margin, margin, W - margin, margin + bracketLen],
      [margin, H - margin - bracketLen, margin, H - margin, margin + bracketLen, H - margin],
      [W - margin - bracketLen, H - margin, W - margin, H - margin, W - margin, H - margin - bracketLen],
    ]
    corners.forEach(c => {
      oCtx.beginPath()
      oCtx.moveTo(c[0], c[1])
      oCtx.lineTo(c[2], c[3])
      oCtx.stroke()
      oCtx.beginPath()
      oCtx.moveTo(c[2], c[3])
      oCtx.lineTo(c[4], c[5])
      oCtx.stroke()
    })

    // Status text
    oCtx.font = 'bold 10px monospace'
    oCtx.fillStyle = '#00ff00'
    oCtx.fillText(`[${INSTRUMENT_LABELS[currentInstrument].toUpperCase()}]  GESTURE: ${gesture.gesture.toUpperCase()}`, margin + 5, margin + 45)

    // Instrument-specific overlays
    if (currentInstrument === 'drums') {
      drawDrumOverlay(oCtx, W, H, gesture, now)
    } else {
      drawMelodicOverlay(oCtx, W, H, gesture, regions)
    }

    // Audio processing based on instrument + gesture
    if (gesture.palmPos) {
      const palmX = gesture.palmPos.x
      const palmY = gesture.palmPos.y

      if (currentInstrument === 'drums') {
        // Drum mode: quadrant-based triggering
        const quadrant = palmX < 0.5
          ? (palmY < 0.5 ? 'hihat' : 'kick')
          : (palmY < 0.5 ? 'crash' : 'snare')
        if (gesture.gesture === 'swipe_down' || Math.abs(gesture.velocityY) > 1.0 || Math.abs(gesture.velocityX) > 1.0) {
          triggerDrumSound(quadrant as 'kick' | 'snare' | 'hihat' | 'crash')
        }
      } else {
        // Melodic instruments
        const freq = xToFreq(palmX)
        let gain = 1 - palmY

        // Spread controls volume for synth/strings
        if ((currentInstrument === 'synth' || currentInstrument === 'strings') && gesture.spread > 0.05) {
          gain = Math.min(gesture.spread * 3, 1)
        }

        setCurrentFreq(freq)
        setCurrentGain(Math.max(0, Math.min(1, gain)))

        if (oscillatorRef.current && gainNodeRef.current && audioContextRef.current) {
          const ctxTime = audioContextRef.current.currentTime

          if (currentInstrument === 'synth') {
            oscillatorRef.current.frequency.setValueAtTime(freq, ctxTime)
            gainNodeRef.current.gain.setValueAtTime(Math.max(0, Math.min(1, gain)), ctxTime)
            // Y controls filter cutoff
            if (filterRef.current) {
              const cutoff = 200 + (1 - palmY) * 4800
              filterRef.current.frequency.setValueAtTime(cutoff, ctxTime)
            }
            // Swipe down = wah effect
            if (gesture.gesture === 'swipe_down' && filterRef.current) {
              filterRef.current.frequency.setValueAtTime(5000, ctxTime)
              filterRef.current.frequency.exponentialRampToValueAtTime(200, ctxTime + 0.3)
            }
          } else if (currentInstrument === 'piano') {
            // Piano: divide into 8 columns for notes
            const noteIndex = Math.floor(palmX * 8)
            const pianoFreqs = [130.81, 146.83, 164.81, 174.61, 196.00, 220.00, 246.94, 261.63]
            const pFreq = pianoFreqs[Math.min(noteIndex, 7)]
            oscillatorRef.current.frequency.setValueAtTime(pFreq, ctxTime)
            const velocity = Math.max(0.1, 1 - palmY)
            gainNodeRef.current.gain.setValueAtTime(velocity, ctxTime)
            setCurrentFreq(pFreq)
          } else if (currentInstrument === 'strings') {
            oscillatorRef.current.frequency.setValueAtTime(freq, ctxTime)
            gainNodeRef.current.gain.setValueAtTime(Math.max(0, Math.min(1, gain)), ctxTime)
            // Spread = vibrato
            if (gesture.spread > 0.08) {
              const vibratoDepth = gesture.spread * 10
              const vibratoRate = 5
              const t = performance.now() / 1000
              const vibrato = Math.sin(t * vibratoRate * Math.PI * 2) * vibratoDepth
              oscillatorRef.current.frequency.setValueAtTime(freq + vibrato, ctxTime)
            }
          }
        }

        // Fist = mute
        if (gesture.gesture === 'fist') {
          if (gainNodeRef.current && audioContextRef.current) {
            gainNodeRef.current.gain.setValueAtTime(0, audioContextRef.current.currentTime)
          }
        }
      }

      // Update shared motion data
      const betaEquivalent = (palmX * 180) - 90
      const gammaEquivalent = ((1 - palmY) * 180) - 90
      setMotionData(prev => ({
        ...prev,
        beta: betaEquivalent,
        gamma: gammaEquivalent,
        acceleration: Math.sqrt(gesture.velocityX * gesture.velocityX + gesture.velocityY * gesture.velocityY),
      }))

      // Record if active
      if (isRecording) {
        recordingRef.current.push({
          timestamp: Date.now(),
          beta: betaEquivalent,
          gamma: gammaEquivalent,
          acceleration: Math.sqrt(gesture.velocityX * gesture.velocityX + gesture.velocityY * gesture.velocityY),
          instrument: currentInstrument,
        })
      }
    }

    animFrameRef.current = requestAnimationFrame(processFrame)
  }, [audioContextRef, oscillatorRef, gainNodeRef, triggerDrumSound, isRecording, recordingRef, currentInstrument, setMotionData])

  function drawDrumOverlay(oCtx: CanvasRenderingContext2D, W: number, H: number, gesture: GestureState, now: number) {
    const halfW = W / 2
    const halfH = H / 2
    const quadrants = [
      { label: 'HI-HAT', color: '#00FFFF', x: 0, y: 0, w: halfW, h: halfH, key: 'hihat' },
      { label: 'CRASH', color: '#FFD700', x: halfW, y: 0, w: halfW, h: halfH, key: 'crash' },
      { label: 'KICK', color: '#ff1493', x: 0, y: halfH, w: halfW, h: halfH, key: 'kick' },
      { label: 'SNARE', color: '#f97316', x: halfW, y: halfH, w: halfW, h: halfH, key: 'snare' },
    ]

    quadrants.forEach(q => {
      const timeSinceHit = now - (drumFlashRef.current[q.key] || 0)
      const flashAlpha = timeSinceHit < 300 ? 0.25 * (1 - timeSinceHit / 300) : 0
      const baseAlpha = 0.06

      oCtx.fillStyle = q.color
      oCtx.globalAlpha = baseAlpha + flashAlpha
      oCtx.fillRect(q.x, q.y, q.w, q.h)
      oCtx.globalAlpha = 1

      // Border
      oCtx.strokeStyle = q.color
      oCtx.globalAlpha = 0.3
      oCtx.lineWidth = 1
      oCtx.strokeRect(q.x + 2, q.y + 2, q.w - 4, q.h - 4)
      oCtx.globalAlpha = 1

      // Label
      oCtx.font = 'bold 16px monospace'
      oCtx.fillStyle = q.color
      oCtx.globalAlpha = 0.6
      oCtx.textAlign = 'center'
      oCtx.fillText(q.label, q.x + q.w / 2, q.y + q.h / 2 + 6)
      oCtx.globalAlpha = 1
    })

    oCtx.textAlign = 'start'

    // Center cross
    oCtx.strokeStyle = 'rgba(255,255,255,0.2)'
    oCtx.lineWidth = 1
    oCtx.beginPath()
    oCtx.moveTo(halfW, 0)
    oCtx.lineTo(halfW, H)
    oCtx.moveTo(0, halfH)
    oCtx.lineTo(W, halfH)
    oCtx.stroke()

    // Draw hand position
    if (gesture.palmPos) {
      const px = gesture.palmPos.x * W
      const py = gesture.palmPos.y * H
      const gradient = oCtx.createRadialGradient(px, py, 0, px, py, 30)
      gradient.addColorStop(0, 'rgba(255, 255, 255, 0.8)')
      gradient.addColorStop(0.5, 'rgba(255, 255, 255, 0.2)')
      gradient.addColorStop(1, 'transparent')
      oCtx.fillStyle = gradient
      oCtx.beginPath()
      oCtx.arc(px, py, 30, 0, Math.PI * 2)
      oCtx.fill()
    }
  }

  function drawMelodicOverlay(oCtx: CanvasRenderingContext2D, W: number, H: number, gesture: GestureState, regions: HandRegion[]) {
    // Pitch guide lines
    oCtx.font = 'bold 10px monospace'
    for (let i = 0; i < NOTE_LABELS.length; i++) {
      const xPos = (i / (NOTE_LABELS.length - 1)) * W
      oCtx.strokeStyle = 'rgba(0, 255, 255, 0.08)'
      oCtx.lineWidth = 1
      oCtx.beginPath()
      oCtx.moveTo(xPos, 0)
      oCtx.lineTo(xPos, H)
      oCtx.stroke()
      oCtx.fillStyle = 'rgba(0, 255, 255, 0.4)'
      oCtx.fillText(NOTE_LABELS[i], xPos + 3, 14)
    }

    // Volume guide labels
    oCtx.fillStyle = 'rgba(0, 255, 255, 0.25)'
    oCtx.font = 'bold 10px monospace'
    oCtx.fillText('LOUD', 4, 28)
    oCtx.fillText('QUIET', 4, H - 6)

    if (gesture.palmPos) {
      const px = gesture.palmPos.x * W
      const py = gesture.palmPos.y * H

      // Hand skeleton visualization
      const palmCx = px
      const palmCy = py + 60
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
        oCtx.moveTo(palmCx, palmCy)
        oCtx.lineTo(ep.x, ep.y)
        oCtx.stroke()
      })

      // Connect fingertips
      oCtx.strokeStyle = 'rgba(0, 255, 0, 0.4)'
      oCtx.lineWidth = 1
      oCtx.beginPath()
      oCtx.moveTo(fingerEndpoints[0].x, fingerEndpoints[0].y)
      for (let fe = 1; fe < fingerEndpoints.length; fe++) {
        oCtx.lineTo(fingerEndpoints[fe].x, fingerEndpoints[fe].y)
      }
      oCtx.stroke()

      // Red joint dots
      oCtx.fillStyle = '#ff0000'
      fingerEndpoints.forEach(ep => {
        oCtx.beginPath()
        oCtx.arc(ep.x, ep.y, 4, 0, Math.PI * 2)
        oCtx.fill()
        const midX = (palmCx + ep.x) / 2
        const midY = (palmCy + ep.y) / 2
        oCtx.beginPath()
        oCtx.arc(midX, midY, 3, 0, Math.PI * 2)
        oCtx.fill()
      })

      // Palm center
      oCtx.beginPath()
      oCtx.arc(palmCx, palmCy, 6, 0, Math.PI * 2)
      oCtx.fill()

      // Glowing tracking circle
      const gradient = oCtx.createRadialGradient(px, py, 0, px, py, 25)
      gradient.addColorStop(0, 'rgba(0, 255, 255, 0.8)')
      gradient.addColorStop(0.5, 'rgba(0, 255, 255, 0.2)')
      gradient.addColorStop(1, 'transparent')
      oCtx.fillStyle = gradient
      oCtx.beginPath()
      oCtx.arc(px, py, 25, 0, Math.PI * 2)
      oCtx.fill()

      // Crosshair
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

      // Draw secondary regions
      if (gesture.fingerTip) {
        const fx = gesture.fingerTip.x * W
        const fy = gesture.fingerTip.y * H
        oCtx.strokeStyle = '#ff1493'
        oCtx.lineWidth = 1.5
        oCtx.beginPath()
        oCtx.arc(fx, fy, 12, 0, Math.PI * 2)
        oCtx.stroke()

        // Line between palm and fingertip
        oCtx.strokeStyle = 'rgba(255, 20, 147, 0.4)'
        oCtx.lineWidth = 1
        oCtx.setLineDash([4, 4])
        oCtx.beginPath()
        oCtx.moveTo(px, py)
        oCtx.lineTo(fx, fy)
        oCtx.stroke()
        oCtx.setLineDash([])
      }

      // Info text
      const noteName = freqToNote(xToFreq(gesture.palmPos.x))
      const freq = xToFreq(gesture.palmPos.x)
      const vol = Math.round((1 - gesture.palmPos.y) * 100)
      oCtx.fillStyle = '#00ffff'
      oCtx.font = 'bold 12px monospace'
      oCtx.fillText(`${noteName} | ${Math.round(freq)}Hz`, px + 35, py - 5)
      oCtx.fillStyle = '#ff1493'
      oCtx.font = '11px monospace'
      oCtx.fillText(`VOL: ${vol}%`, px + 35, py + 12)
    }
  }

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
  }, [initAudio, processFrame, setCameraActive])

  const stopCamera = useCallback(() => {
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current)
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop())
      streamRef.current = null
    }
    setCameraActive(false)
    stopSound()
    prevTimeRef.current = 0
  }, [stopSound, setCameraActive])

  // Auto-start camera on mount
  const autoStartedRef = useRef(false)
  useEffect(() => {
    if (!autoStartedRef.current && !cameraActive) {
      autoStartedRef.current = true
      startCamera()
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current)
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop())
      }
      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current)
      }
    }
  }, [])

  const currentNote = freqToNote(currentFreq)
  const volumePercent = Math.round(currentGain * 100)
  const hasTracking = gestureState.palmPos !== null

  return (
    <div className="flex flex-col items-center gap-3 px-2 pb-24 pt-2" style={{ background: '#000000' }}>
      {/* Compact Instrument Selector + Gesture Guide */}
      <div className="flex gap-1.5 w-full max-w-3xl">
        {(['synth', 'piano', 'strings', 'drums'] as InstrumentType[]).map((inst) => {
          const isSelected = currentInstrument === inst
          return (
            <button
              key={inst}
              onClick={() => {
                setCurrentInstrument(inst)
                if (isPlaying) stopSound()
              }}
              className="flex-1 flex items-center justify-center gap-1.5 py-2 px-2 rounded-lg transition-all duration-200"
              style={{
                background: isSelected ? `${INSTRUMENT_COLORS[inst]}18` : 'rgba(255,255,255,0.03)',
                border: `1px solid ${isSelected ? INSTRUMENT_COLORS[inst] : 'rgba(255,255,255,0.08)'}`,
                color: isSelected ? INSTRUMENT_COLORS[inst] : '#6b7280',
                boxShadow: isSelected ? `0 0 12px ${INSTRUMENT_COLORS[inst]}40` : 'none',
              }}
            >
              <span className="text-sm">{INSTRUMENT_ICONS[inst]}</span>
              <span className="text-[11px] font-semibold tracking-wide">{INSTRUMENT_LABELS[inst]}</span>
            </button>
          )
        })}
      </div>

      {/* Gesture Guide Strip */}
      <div className="w-full max-w-3xl rounded-lg px-3 py-1.5 text-center" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(0,255,255,0.1)' }}>
        <span className="text-[10px] font-mono font-bold tracking-wide" style={{ color: '#00FFFF' }}>
          {GESTURE_GUIDES[currentInstrument]}
        </span>
      </div>

      {/* CAMERA FEED - Full Width & Prominent */}
      <div className="relative w-full max-w-3xl overflow-hidden rounded-xl" style={{ border: `2px solid ${cameraActive ? (hasTracking ? 'rgba(0,255,0,0.4)' : 'rgba(0,255,255,0.3)') : 'rgba(255,255,255,0.1)'}`, background: '#0a0a0a', boxShadow: cameraActive ? '0 0 30px rgba(0,255,0,0.1)' : 'none' }}>
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

          {/* Camera Off / Loading State */}
          {!cameraActive && (
            <button
              onClick={startCamera}
              className="absolute inset-0 flex flex-col items-center justify-center gap-4 cursor-pointer transition-all duration-300 hover:bg-white/[0.02]"
              style={{ background: '#0a0a0a' }}
            >
              <div className="w-20 h-20 rounded-full flex items-center justify-center animate-pulse" style={{ background: 'linear-gradient(135deg, rgba(255,20,147,0.15), rgba(0,255,255,0.15))', border: '2px solid rgba(0,255,255,0.3)' }}>
                <FaVideo className="text-3xl" style={{ color: '#00FFFF' }} />
              </div>
              <div className="text-center">
                <p className="text-base font-bold" style={{ color: '#00FFFF' }}>
                  Tap to Start Camera
                </p>
                <p className="text-xs mt-1" style={{ color: 'rgba(255,255,255,0.4)' }}>
                  Play {INSTRUMENT_LABELS[currentInstrument]} with hand gestures
                </p>
              </div>
              <div className="flex items-center gap-1.5 text-[10px]" style={{ color: 'rgba(255,20,147,0.6)' }}>
                <FaCrosshairs className="text-[8px]" />
                <span>Camera auto-starting...</span>
              </div>
            </button>
          )}

            {/* Top-left: Recording control */}
            {cameraActive && (
              <div className="absolute top-3 left-3 z-10">
                <button
                  onClick={isRecording ? handleStopRecording : handleStartRecording}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-full transition-all duration-200"
                  style={{
                    background: isRecording ? 'rgba(255,0,0,0.8)' : 'rgba(255,0,0,0.2)',
                    border: '1px solid rgba(255,0,0,0.5)',
                    color: '#ffffff',
                  }}
                >
                  {isRecording ? <FaStop className="text-xs" /> : <FaCircle className="text-xs" style={{ color: '#ff0000' }} />}
                  <span className="text-[10px] font-bold tracking-wider">
                    {isRecording ? formatDuration(recordingElapsed) : 'REC'}
                  </span>
                </button>
              </div>
            )}

            {/* Top-center: Recording timer */}
            {cameraActive && isRecording && (
              <div className="absolute top-3 left-1/2 -translate-x-1/2 z-10">
                <Badge className="text-[10px] border-0 font-mono animate-pulse" style={{ background: 'rgba(255,0,0,0.3)', color: '#ff0000', border: '1px solid rgba(255,0,0,0.5)' }}>
                  <FaCircle className="mr-1 text-[6px]" style={{ color: '#ff0000' }} />
                  RECORDING {formatDuration(recordingElapsed)}
                </Badge>
              </div>
            )}

            {/* Top-right: Tracking status */}
            {cameraActive && (
              <div className="absolute top-3 right-3 z-10">
                <Badge
                  className="text-[10px] border-0 font-bold tracking-wider"
                  style={{
                    background: hasTracking ? 'rgba(0,255,0,0.15)' : 'rgba(255,0,0,0.15)',
                    color: hasTracking ? '#00ff00' : '#ff0000',
                    border: `1px solid ${hasTracking ? 'rgba(0,255,0,0.3)' : 'rgba(255,0,0,0.3)'}`,
                  }}
                >
                  <FaHandPaper className="mr-1" />
                  {hasTracking ? 'TRACKING' : 'NO SIGNAL'}
                </Badge>
              </div>
            )}

            {/* Bottom-left: Note & Frequency display overlay */}
            {cameraActive && (
              <div className="absolute bottom-3 left-3 z-10 flex items-center gap-2">
                <div className="px-3 py-1.5 rounded-lg" style={{ background: 'rgba(0,0,0,0.7)', border: `1px solid ${accentColor}50` }}>
                  <div className="text-xl font-black font-mono" style={{ color: hasTracking ? accentColor : '#4b5563' }}>
                    {currentInstrument === 'drums'
                      ? (hasTracking && lastDrumHit ? lastDrumHit.toUpperCase() : '--')
                      : (hasTracking ? currentNote : '--')}
                  </div>
                  <div className="text-[9px] font-mono" style={{ color: '#00FFFF' }}>
                    {currentInstrument === 'drums' ? 'LAST HIT' : `${hasTracking ? Math.round(currentFreq) : '--'} Hz`}
                  </div>
                </div>
                <div className="flex flex-col gap-1">
                  <div className="px-2 py-1 rounded" style={{ background: 'rgba(0,0,0,0.7)', border: '1px solid rgba(255,20,147,0.3)' }}>
                    <div className="text-[9px] font-mono" style={{ color: '#ff1493' }}>VOL {hasTracking ? `${volumePercent}%` : '--'}</div>
                  </div>
                </div>
              </div>
            )}

            {/* Bottom-right: Gesture indicator */}
            {cameraActive && hasTracking && (
              <div className="absolute bottom-3 right-3 z-10">
                <Badge
                  className="text-[10px] border-0 font-bold tracking-wider flex items-center gap-1"
                  style={{
                    background: 'rgba(255,20,147,0.2)',
                    color: '#ff1493',
                    border: '1px solid rgba(255,20,147,0.4)',
                  }}
                >
                  {GESTURE_ICON_MAP[gestureState.gesture] || <FaCrosshairs />}
                  {gestureState.gesture.toUpperCase().replace('_', ' ')}
                </Badge>
              </div>
            )}
          </div>
        </div>

      {/* Camera Error */}
      {cameraError && (
        <div className="w-full max-w-3xl text-center px-4 py-3 rounded-xl" style={{ background: 'rgba(255,0,0,0.08)', border: '1px solid rgba(255,0,0,0.2)' }}>
          <p className="text-sm" style={{ color: '#ff4444' }}>{cameraError}</p>
          <button
            onClick={startCamera}
            className="mt-2 px-4 py-1.5 rounded-lg text-xs font-bold"
            style={{ background: 'rgba(0,255,255,0.15)', color: '#00FFFF', border: '1px solid rgba(0,255,255,0.3)' }}
          >
            Retry Camera
          </button>
        </div>
      )}

      {/* Compact Controls Row */}
      <div className="flex gap-2 w-full max-w-3xl">
        <Button
          onClick={cameraActive ? stopCamera : startCamera}
          className="py-3 px-4 text-sm font-bold rounded-lg flex items-center justify-center gap-2 border-0 transition-all duration-300"
          style={{
            background: cameraActive ? 'rgba(255,0,0,0.6)' : 'linear-gradient(135deg, #ff1493, #00FFFF)',
            color: '#ffffff',
            boxShadow: cameraActive ? 'none' : '0 0 15px rgba(255,20,147,0.3)',
          }}
        >
          {cameraActive ? <FaVideoSlash /> : <FaVideo />}
          {cameraActive ? 'Stop' : 'Start Camera'}
        </Button>
        {cameraActive && (
          <Button
            onClick={() => {
              initAudio()
              if (isPlaying) stopSound()
              else startSound()
            }}
            className="flex-1 py-3 px-4 text-sm font-bold rounded-lg border-0 transition-all duration-300"
            style={{
              background: isPlaying ? 'rgba(0,255,0,0.15)' : 'rgba(255,0,0,0.15)',
              color: isPlaying ? '#00ff00' : '#ff4444',
              border: `1px solid ${isPlaying ? 'rgba(0,255,0,0.3)' : 'rgba(255,0,0,0.3)'}`,
            }}
          >
            {isPlaying ? <><FaVolumeUp className="mr-1.5" /> Sound ON</> : <><FaVolumeMute className="mr-1.5" /> Sound OFF</>}
          </Button>
        )}
        {cameraActive && (
          <Button
            onClick={isRecording ? handleStopRecording : handleStartRecording}
            className="py-3 px-4 text-sm font-bold rounded-lg border-0 transition-all duration-300"
            style={{
              background: isRecording ? 'rgba(255,0,0,0.3)' : 'rgba(255,0,0,0.08)',
              color: isRecording ? '#ff0000' : '#ff4444',
              border: `1px solid ${isRecording ? 'rgba(255,0,0,0.5)' : 'rgba(255,0,0,0.2)'}`,
            }}
          >
            {isRecording ? <><FaStop className="mr-1.5" /> Stop</> : <><FaCircle className="mr-1.5" style={{ color: '#ff0000' }} /> Rec</>}
          </Button>
        )}
      </div>

      {/* Compact Telemetry - Horizontal */}
      <div className="w-full max-w-3xl rounded-xl overflow-hidden" style={{ background: '#0a0a0a', border: '1px solid rgba(255,20,147,0.15)' }}>
        <div className="flex items-center gap-0.5 p-2">
          <div className="flex-1 px-2 py-1.5 rounded-lg text-center" style={{ background: 'rgba(255,255,255,0.03)' }}>
            <div className="text-[8px] font-bold tracking-widest" style={{ color: '#ff1493' }}>X</div>
            <div className="text-sm font-mono font-bold" style={{ color: '#00FFFF' }}>
              {hasTracking && gestureState.palmPos ? `${Math.round(gestureState.palmPos.x * 100)}%` : '--'}
            </div>
          </div>
          <div className="flex-1 px-2 py-1.5 rounded-lg text-center" style={{ background: 'rgba(255,255,255,0.03)' }}>
            <div className="text-[8px] font-bold tracking-widest" style={{ color: '#ff1493' }}>Y</div>
            <div className="text-sm font-mono font-bold" style={{ color: '#00FFFF' }}>
              {hasTracking && gestureState.palmPos ? `${Math.round(gestureState.palmPos.y * 100)}%` : '--'}
            </div>
          </div>
          <div className="flex-1 px-2 py-1.5 rounded-lg text-center" style={{ background: 'rgba(255,255,255,0.03)' }}>
            <div className="text-[8px] font-bold tracking-widest" style={{ color: '#ff1493' }}>SPREAD</div>
            <div className="text-sm font-mono font-bold" style={{ color: gestureState.spread > 0.1 ? '#00ff00' : '#f97316' }}>
              {hasTracking ? `${Math.round(gestureState.spread * 100)}%` : '--'}
            </div>
          </div>
          <div className="flex-1 px-2 py-1.5 rounded-lg text-center" style={{ background: 'rgba(255,255,255,0.03)' }}>
            <div className="text-[8px] font-bold tracking-widest" style={{ color: '#ff1493' }}>GESTURE</div>
            <div className="text-xs font-mono font-bold flex items-center justify-center gap-1" style={{ color: hasTracking ? '#ff1493' : '#4b5563' }}>
              {GESTURE_ICON_MAP[gestureState.gesture] || <FaCrosshairs />}
              <span className="truncate">{hasTracking ? gestureState.gesture.toUpperCase().replace('_', ' ') : '--'}</span>
            </div>
          </div>
          <div className="flex-1 px-2 py-1.5 rounded-lg text-center" style={{ background: 'rgba(255,255,255,0.03)' }}>
            <div className="text-[8px] font-bold tracking-widest" style={{ color: '#ff1493' }}>CONF</div>
            <div className="text-sm font-mono font-bold" style={{ color: gestureState.confidence > 0.5 ? '#00ff00' : '#f97316' }}>
              {hasTracking ? `${Math.round(gestureState.confidence * 100)}%` : '--'}
            </div>
          </div>
        </div>
      </div>

      {/* Status Bar */}
      <div className="flex items-center gap-3 text-[10px] font-mono">
        <div className="flex items-center gap-1.5">
          <FaCircle className="text-[5px]" style={{ color: cameraActive ? '#00ff00' : '#ff0000' }} />
          <span style={{ color: cameraActive ? '#00ff00' : '#ff0000' }}>
            {cameraActive ? 'LIVE' : 'OFF'}
          </span>
        </div>
        {hasTracking && (
          <>
            <span style={{ color: 'rgba(255,255,255,0.2)' }}>|</span>
            <span style={{ color: '#ff1493' }}>{INSTRUMENT_LABELS[currentInstrument]}</span>
          </>
        )}
        {isPlaying && (
          <>
            <span style={{ color: 'rgba(255,255,255,0.2)' }}>|</span>
            <span style={{ color: '#00ff00' }}>Sound ON</span>
          </>
        )}
        {isRecording && (
          <>
            <span style={{ color: 'rgba(255,255,255,0.2)' }}>|</span>
            <span style={{ color: '#ff0000' }}>REC</span>
          </>
        )}
      </div>
    </div>
  )
}

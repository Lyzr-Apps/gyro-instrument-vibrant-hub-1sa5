'use client'

import React, { useEffect, useRef, useCallback } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { FaMusic, FaGuitar, FaDrum, FaVolumeUp } from 'react-icons/fa'

export type InstrumentType = 'synth' | 'piano' | 'strings' | 'drums'

export interface MotionData {
  alpha: number
  beta: number
  gamma: number
  acceleration: number
}

export interface MotionSnapshot {
  timestamp: number
  beta: number
  gamma: number
  acceleration: number
  instrument: InstrumentType
}

interface InstrumentSectionProps {
  motionEnabled: boolean
  setMotionEnabled: (v: boolean) => void
  motionData: MotionData
  setMotionData: React.Dispatch<React.SetStateAction<MotionData>>
  currentInstrument: InstrumentType
  setCurrentInstrument: (i: InstrumentType) => void
  isPlaying: boolean
  setIsPlaying: (v: boolean) => void
  isRecording: boolean
  recordingRef: React.MutableRefObject<MotionSnapshot[]>
  audioContextRef: React.MutableRefObject<AudioContext | null>
  oscillatorRef: React.MutableRefObject<OscillatorNode | null>
  gainNodeRef: React.MutableRefObject<GainNode | null>
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

function betaToFreq(beta: number): number {
  const normalizedBeta = Math.max(-90, Math.min(90, beta))
  const ratio = (normalizedBeta + 90) / 180
  return 130.81 * Math.pow(2, ratio * 2)
}

function gammaToGain(gamma: number): number {
  const normalized = Math.max(-90, Math.min(90, gamma))
  return (normalized + 90) / 180
}

function freqToNote(freq: number): string {
  const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
  const noteNum = 12 * (Math.log2(freq / 440)) + 69
  const note = Math.round(noteNum)
  const octave = Math.floor(note / 12) - 1
  return noteNames[((note % 12) + 12) % 12] + octave
}

export default function InstrumentSection({
  motionEnabled,
  setMotionEnabled,
  motionData,
  setMotionData,
  currentInstrument,
  setCurrentInstrument,
  isPlaying,
  setIsPlaying,
  isRecording,
  recordingRef,
  audioContextRef,
  oscillatorRef,
  gainNodeRef,
}: InstrumentSectionProps) {
  const filterRef = useRef<BiquadFilterNode | null>(null)
  const percussionTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pulseRef = useRef(false)

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
      const osc2 = ctx.createOscillator()
      osc2.type = 'sine'
      osc2.detune.value = 5
      osc2.connect(gainNodeRef.current)
      osc2.start()
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
    pulseRef.current = true
    if (percussionTimeoutRef.current) clearTimeout(percussionTimeoutRef.current)
    percussionTimeoutRef.current = setTimeout(() => { pulseRef.current = false }, 200)
  }, [audioContextRef])

  const requestMotionPermission = useCallback(async () => {
    initAudio()
    try {
      if (typeof (DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> }).requestPermission === 'function') {
        const permission = await (DeviceOrientationEvent as unknown as { requestPermission: () => Promise<string> }).requestPermission()
        if (permission === 'granted') {
          setMotionEnabled(true)
        }
      } else {
        setMotionEnabled(true)
      }
      if (typeof (DeviceMotionEvent as unknown as { requestPermission?: () => Promise<string> }).requestPermission === 'function') {
        await (DeviceMotionEvent as unknown as { requestPermission: () => Promise<string> }).requestPermission()
      }
    } catch (_err) {
      setMotionEnabled(true)
    }
  }, [initAudio, setMotionEnabled])

  useEffect(() => {
    if (!motionEnabled) return

    const handleOrientation = (e: DeviceOrientationEvent) => {
      const alpha = e.alpha ?? 0
      const beta = e.beta ?? 0
      const gamma = e.gamma ?? 0
      setMotionData((prev: MotionData) => ({ ...prev, alpha, beta, gamma }))
      if (oscillatorRef.current && gainNodeRef.current) {
        const freq = betaToFreq(beta)
        oscillatorRef.current.frequency.setValueAtTime(freq, audioContextRef.current?.currentTime ?? 0)
        gainNodeRef.current.gain.setValueAtTime(gammaToGain(gamma), audioContextRef.current?.currentTime ?? 0)
      }
    }

    const handleMotion = (e: DeviceMotionEvent) => {
      const acc = e.accelerationIncludingGravity
      if (!acc) return
      const magnitude = Math.sqrt((acc.x ?? 0) ** 2 + (acc.y ?? 0) ** 2 + (acc.z ?? 0) ** 2)
      setMotionData((prev: MotionData) => ({ ...prev, acceleration: magnitude }))
      if (magnitude > 20) {
        triggerPercussion()
      }
    }

    window.addEventListener('deviceorientation', handleOrientation)
    window.addEventListener('devicemotion', handleMotion)
    return () => {
      window.removeEventListener('deviceorientation', handleOrientation)
      window.removeEventListener('devicemotion', handleMotion)
    }
  }, [motionEnabled, setMotionData, oscillatorRef, gainNodeRef, audioContextRef, triggerPercussion])

  useEffect(() => {
    if (!isRecording) return
    const interval = setInterval(() => {
      recordingRef.current.push({
        timestamp: Date.now(),
        beta: motionData.beta,
        gamma: motionData.gamma,
        acceleration: motionData.acceleration,
        instrument: currentInstrument,
      })
    }, 50)
    return () => clearInterval(interval)
  }, [isRecording, motionData, currentInstrument, recordingRef])

  const accentColor = INSTRUMENT_COLORS[currentInstrument]
  const currentFreq = betaToFreq(motionData.beta)
  const currentGain = gammaToGain(motionData.gamma)
  const currentNote = freqToNote(currentFreq)

  const vizSize = 60 + currentGain * 40
  const vizOpacity = isPlaying ? 0.3 + currentGain * 0.7 : 0.15

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

      {/* Enable Motion Button */}
      {!motionEnabled && (
        <Button
          onClick={requestMotionPermission}
          className="w-full max-w-md py-6 text-lg font-semibold rounded-xl"
          style={{ background: accentColor }}
        >
          Enable Motion Controls
        </Button>
      )}

      {/* Main Visualization */}
      <div className="relative flex items-center justify-center" style={{ width: 260, height: 260 }}>
        <div
          className="absolute rounded-full transition-all duration-150"
          style={{
            width: `${vizSize + 30}%`,
            height: `${vizSize + 30}%`,
            background: `radial-gradient(circle, ${accentColor}15, transparent)`,
            opacity: vizOpacity * 0.5,
          }}
        />
        <div
          className="absolute rounded-full transition-all duration-100"
          style={{
            width: `${vizSize + 10}%`,
            height: `${vizSize + 10}%`,
            background: `radial-gradient(circle, ${accentColor}30, transparent)`,
            opacity: vizOpacity * 0.7,
          }}
        />
        <div
          className="rounded-full flex items-center justify-center transition-all duration-100"
          style={{
            width: `${vizSize}%`,
            height: `${vizSize}%`,
            background: `radial-gradient(circle, ${accentColor}50, ${accentColor}10)`,
            border: `2px solid ${accentColor}80`,
            boxShadow: isPlaying ? `0 0 40px ${accentColor}40, 0 0 80px ${accentColor}20` : 'none',
            opacity: vizOpacity,
          }}
        >
          <div className="text-center">
            <div className="text-3xl font-bold text-white">{currentNote}</div>
            <div className="text-xs text-gray-400 mt-1">{Math.round(currentFreq)} Hz</div>
          </div>
        </div>
      </div>

      {/* Play/Stop Button */}
      {motionEnabled && (
        <div className="flex gap-3 w-full max-w-md">
          <Button
            onClick={() => {
              initAudio()
              if (isPlaying) stopSound()
              else startSound()
            }}
            className="flex-1 py-5 text-base font-semibold rounded-xl"
            style={{
              background: isPlaying ? 'rgba(239,68,68,0.8)' : accentColor,
            }}
          >
            {isPlaying ? 'Stop' : 'Play'}
          </Button>
        </div>
      )}

      {/* Motion Telemetry */}
      <Card className="w-full max-w-md border-0" style={{ background: 'rgba(255,255,255,0.05)', backdropFilter: 'blur(12px)' }}>
        <CardContent className="p-4">
          <div className="text-xs text-gray-500 uppercase tracking-wider mb-3 font-semibold">Motion Data</div>
          <div className="grid grid-cols-2 gap-3">
            <div className="p-3 rounded-lg" style={{ background: 'rgba(255,255,255,0.05)' }}>
              <div className="text-xs text-gray-500">Beta (Pitch)</div>
              <div className="text-lg font-mono text-white">{motionData.beta.toFixed(1)}</div>
              <div className="mt-1 h-1 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.1)' }}>
                <div className="h-full rounded-full transition-all" style={{ width: `${((motionData.beta + 90) / 180) * 100}%`, background: accentColor }} />
              </div>
            </div>
            <div className="p-3 rounded-lg" style={{ background: 'rgba(255,255,255,0.05)' }}>
              <div className="text-xs text-gray-500">Gamma (Volume)</div>
              <div className="text-lg font-mono text-white">{motionData.gamma.toFixed(1)}</div>
              <div className="mt-1 h-1 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.1)' }}>
                <div className="h-full rounded-full transition-all" style={{ width: `${currentGain * 100}%`, background: accentColor }} />
              </div>
            </div>
            <div className="p-3 rounded-lg" style={{ background: 'rgba(255,255,255,0.05)' }}>
              <div className="text-xs text-gray-500">Alpha (Rotation)</div>
              <div className="text-lg font-mono text-white">{motionData.alpha.toFixed(1)}</div>
            </div>
            <div className="p-3 rounded-lg" style={{ background: 'rgba(255,255,255,0.05)' }}>
              <div className="text-xs text-gray-500">Acceleration</div>
              <div className="text-lg font-mono text-white">{motionData.acceleration.toFixed(1)}</div>
              {motionData.acceleration > 20 && (
                <Badge className="mt-1 text-xs" style={{ background: INSTRUMENT_COLORS.drums }}>SHAKE!</Badge>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Status */}
      <div className="flex items-center gap-2 text-xs text-gray-500">
        <div className="w-2 h-2 rounded-full" style={{ background: motionEnabled ? '#22c55e' : '#ef4444' }} />
        {motionEnabled ? 'Motion sensors active' : 'Motion sensors inactive'}
        {isPlaying && (
          <>
            <div className="w-1 h-1 rounded-full bg-gray-600" />
            <span style={{ color: accentColor }}>Playing {INSTRUMENT_LABELS[currentInstrument]}</span>
          </>
        )}
      </div>
    </div>
  )
}

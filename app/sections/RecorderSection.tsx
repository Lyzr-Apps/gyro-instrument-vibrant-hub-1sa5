'use client'

import React, { useState, useEffect, useRef, useCallback } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { FaCircle, FaStop, FaPlay, FaChartBar } from 'react-icons/fa'
import type { MotionSnapshot, InstrumentType } from './InstrumentSection'

export interface RecordedSession {
  id: string
  startTime: number
  duration: number
  snapshots: MotionSnapshot[]
  instruments: InstrumentType[]
  noteCount: number
}

interface RecorderSectionProps {
  isRecording: boolean
  setIsRecording: (v: boolean) => void
  recordingRef: React.MutableRefObject<MotionSnapshot[]>
  sessions: RecordedSession[]
  setSessions: (s: RecordedSession[] | ((prev: RecordedSession[]) => RecordedSession[])) => void
  onAnalyze: (session: RecordedSession) => void
  motionEnabled: boolean
}

const INSTRUMENT_COLORS: Record<InstrumentType, string> = {
  synth: '#a855f7',
  piano: '#3b82f6',
  strings: '#22c55e',
  drums: '#f97316',
}

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000)
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

export default function RecorderSection({
  isRecording,
  setIsRecording,
  recordingRef,
  sessions,
  setSessions,
  onAnalyze,
  motionEnabled,
}: RecorderSectionProps) {
  const [recordingDuration, setRecordingDuration] = useState(0)
  const recordingStartRef = useRef<number>(0)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const [playingId, setPlayingId] = useState<string | null>(null)

  const startRecording = useCallback(() => {
    if (!motionEnabled) return
    recordingRef.current = []
    recordingStartRef.current = Date.now()
    setRecordingDuration(0)
    setIsRecording(true)
    timerRef.current = setInterval(() => {
      setRecordingDuration(Date.now() - recordingStartRef.current)
    }, 100)
  }, [motionEnabled, recordingRef, setIsRecording])

  const stopRecording = useCallback(() => {
    setIsRecording(false)
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
    const snapshots = [...recordingRef.current]
    if (snapshots.length === 0) return
    const duration = Date.now() - recordingStartRef.current
    const instrumentSet = new Set(snapshots.map((s) => s.instrument))
    const session: RecordedSession = {
      id: `session-${Date.now()}`,
      startTime: recordingStartRef.current,
      duration,
      snapshots,
      instruments: Array.from(instrumentSet),
      noteCount: snapshots.length,
    }
    setSessions((prev: RecordedSession[]) => [session, ...prev])
    recordingRef.current = []
  }, [recordingRef, setIsRecording, setSessions])

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [])

  const handlePlayback = useCallback((session: RecordedSession) => {
    if (playingId === session.id) {
      setPlayingId(null)
      return
    }
    setPlayingId(session.id)
    const duration = session.duration
    setTimeout(() => setPlayingId(null), duration)
  }, [playingId])

  return (
    <div className="flex flex-col gap-4 px-4 pb-24 pt-4">
      {/* Recording Controls */}
      <Card className="border-0" style={{ background: 'rgba(255,255,255,0.05)', backdropFilter: 'blur(12px)' }}>
        <CardContent className="p-6">
          <div className="flex flex-col items-center gap-4">
            {isRecording ? (
              <>
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-red-500 animate-pulse" />
                  <span className="text-red-400 text-sm font-medium">Recording</span>
                </div>
                <div className="text-4xl font-mono text-white">
                  {formatDuration(recordingDuration)}
                </div>
                <Button
                  onClick={stopRecording}
                  className="w-full max-w-xs py-5 rounded-xl text-base font-semibold"
                  style={{ background: '#ef4444' }}
                >
                  <FaStop className="mr-2" /> Stop Recording
                </Button>
              </>
            ) : (
              <>
                <div className="text-center">
                  <h3 className="text-white font-semibold mb-1">Motion Recorder</h3>
                  <p className="text-gray-500 text-sm">
                    {motionEnabled
                      ? 'Record your performance to analyze it later.'
                      : 'Enable motion controls on the Instrument tab first.'}
                  </p>
                </div>
                <Button
                  onClick={startRecording}
                  disabled={!motionEnabled}
                  className="w-full max-w-xs py-5 rounded-xl text-base font-semibold"
                  style={{ background: motionEnabled ? '#ef4444' : 'rgba(255,255,255,0.1)' }}
                >
                  <FaCircle className="mr-2 text-sm" /> Start Recording
                </Button>
              </>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Sessions List */}
      <div>
        <h3 className="text-white font-semibold mb-3 text-sm uppercase tracking-wider">
          Recorded Sessions ({sessions.length})
        </h3>
        {sessions.length === 0 ? (
          <Card className="border-0" style={{ background: 'rgba(255,255,255,0.03)' }}>
            <CardContent className="p-8 text-center">
              <FaCircle className="text-3xl text-gray-700 mx-auto mb-3" />
              <p className="text-gray-500 text-sm">No recordings yet. Start a session to capture your performance.</p>
            </CardContent>
          </Card>
        ) : (
          <ScrollArea className="max-h-[60vh]">
            <div className="space-y-3">
              {sessions.map((session) => {
                const betaValues = session.snapshots.map((s) => s.beta)
                const gammaValues = session.snapshots.map((s) => s.gamma)
                const minBeta = betaValues.length > 0 ? Math.min(...betaValues) : 0
                const maxBeta = betaValues.length > 0 ? Math.max(...betaValues) : 0
                const shakeCount = session.snapshots.filter((s) => s.acceleration > 20).length

                return (
                  <Card key={session.id} className="border-0" style={{ background: 'rgba(255,255,255,0.05)' }}>
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between mb-3">
                        <div>
                          <div className="text-white font-medium text-sm">
                            Session {new Date(session.startTime).toLocaleTimeString()}
                          </div>
                          <div className="text-gray-500 text-xs mt-0.5">
                            {formatDuration(session.duration)} duration
                          </div>
                        </div>
                        <div className="flex gap-1">
                          {Array.isArray(session.instruments) && session.instruments.map((inst) => (
                            <Badge
                              key={inst}
                              className="text-xs capitalize"
                              style={{ background: `${INSTRUMENT_COLORS[inst]}30`, color: INSTRUMENT_COLORS[inst], border: 'none' }}
                            >
                              {inst}
                            </Badge>
                          ))}
                        </div>
                      </div>

                      <div className="grid grid-cols-3 gap-2 mb-3">
                        <div className="text-center p-2 rounded-lg" style={{ background: 'rgba(255,255,255,0.05)' }}>
                          <div className="text-xs text-gray-500">Notes</div>
                          <div className="text-sm font-mono text-white">{session.noteCount}</div>
                        </div>
                        <div className="text-center p-2 rounded-lg" style={{ background: 'rgba(255,255,255,0.05)' }}>
                          <div className="text-xs text-gray-500">Pitch Range</div>
                          <div className="text-sm font-mono text-white">{minBeta.toFixed(0)} - {maxBeta.toFixed(0)}</div>
                        </div>
                        <div className="text-center p-2 rounded-lg" style={{ background: 'rgba(255,255,255,0.05)' }}>
                          <div className="text-xs text-gray-500">Shakes</div>
                          <div className="text-sm font-mono text-white">{shakeCount}</div>
                        </div>
                      </div>

                      <div className="flex gap-2">
                        <Button
                          onClick={() => handlePlayback(session)}
                          variant="outline"
                          className="flex-1 text-xs border-0"
                          style={{ background: 'rgba(255,255,255,0.08)', color: playingId === session.id ? '#22c55e' : 'white' }}
                        >
                          <FaPlay className="mr-1.5" />
                          {playingId === session.id ? 'Playing...' : 'Playback'}
                        </Button>
                        <Button
                          onClick={() => onAnalyze(session)}
                          variant="outline"
                          className="flex-1 text-xs border-0"
                          style={{ background: 'rgba(59,130,246,0.15)', color: '#3b82f6' }}
                        >
                          <FaChartBar className="mr-1.5" /> Analyze
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                )
              })}
            </div>
          </ScrollArea>
        )}
      </div>
    </div>
  )
}

'use client'

import React, { useState, useRef, useCallback } from 'react'
import { FaHandPaper, FaRecordVinyl, FaChartBar } from 'react-icons/fa'
import { callAIAgent, extractText } from '@/lib/aiAgent'
import type { MotionData, InstrumentType, MotionSnapshot } from './sections/InstrumentSection'
import GuideSection from './sections/GuideSection'
import RecorderSection from './sections/RecorderSection'
import type { RecordedSession } from './sections/RecorderSection'
import AnalyzerSection from './sections/AnalyzerSection'
import CameraSection from './sections/CameraSection'

const SESSION_ANALYZER_ID = '69a51ec0f92cf455a85ecc35'

interface AnalysisResult {
  overall_score: number
  summary: string
  rhythm_analysis: string
  expressiveness_rating: string
  pitch_analysis: string
  technique_notes: string
  suggestions: string[]
  session_highlights: string[]
}

class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; error: string }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props)
    this.state = { hasError: false, error: '' }
  }
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error: error.message }
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center" style={{ background: '#000000', color: 'white' }}>
          <div className="text-center p-8 max-w-md">
            <h2 className="text-xl font-semibold mb-2">Something went wrong</h2>
            <p className="text-gray-400 mb-4 text-sm">{this.state.error}</p>
            <button
              onClick={() => this.setState({ hasError: false, error: '' })}
              className="px-4 py-2 rounded-md text-sm font-semibold"
              style={{ background: '#ff1493' }}
            >
              Try again
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}

type TabId = 'instrument' | 'recordings' | 'analysis'

const TABS: { id: TabId; label: string; icon: React.ReactNode }[] = [
  { id: 'instrument', label: 'Play', icon: <FaHandPaper /> },
  { id: 'recordings', label: 'Recordings', icon: <FaRecordVinyl /> },
  { id: 'analysis', label: 'Analysis', icon: <FaChartBar /> },
]

export default function Page() {
  const [activeTab, setActiveTab] = useState<TabId>('instrument')

  // Instrument state
  const [motionData, setMotionData] = useState<MotionData>({ alpha: 0, beta: 0, gamma: 0, acceleration: 0 })
  const [currentInstrument, setCurrentInstrument] = useState<InstrumentType>('synth')
  const [isPlaying, setIsPlaying] = useState(false)

  // Audio refs
  const audioContextRef = useRef<AudioContext | null>(null)
  const oscillatorRef = useRef<OscillatorNode | null>(null)
  const gainNodeRef = useRef<GainNode | null>(null)

  // Recording state
  const [isRecording, setIsRecording] = useState(false)
  const recordingRef = useRef<MotionSnapshot[]>([])
  const [sessions, setSessions] = useState<RecordedSession[]>([])
  const [cameraActive, setCameraActive] = useState(false)

  // Analysis state
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null)
  const [analysisLoading, setAnalysisLoading] = useState(false)
  const [analyzedSession, setAnalyzedSession] = useState<RecordedSession | null>(null)

  const handleAnalyze = useCallback(async (session: RecordedSession) => {
    setActiveTab('analysis')
    setAnalysisLoading(true)
    setAnalyzedSession(session)
    setAnalysisResult(null)

    const betaValues = session.snapshots.map((s) => s.beta)
    const gammaValues = session.snapshots.map((s) => s.gamma)
    const minBeta = betaValues.length > 0 ? Math.min(...betaValues) : 0
    const maxBeta = betaValues.length > 0 ? Math.max(...betaValues) : 0
    const minGamma = gammaValues.length > 0 ? Math.min(...gammaValues) : 0
    const maxGamma = gammaValues.length > 0 ? Math.max(...gammaValues) : 0
    const shakeCount = session.snapshots.filter((s) => s.acceleration > 20).length
    const instrumentSet = Array.isArray(session.instruments) ? session.instruments.join(', ') : 'unknown'

    const summary = [
      `Session Duration: ${(session.duration / 1000).toFixed(1)} seconds`,
      `Instruments Used: ${instrumentSet}`,
      `Total Note Snapshots: ${session.noteCount}`,
      `Pitch Range (Beta): ${minBeta.toFixed(1)} to ${maxBeta.toFixed(1)} degrees`,
      `Volume Range (Gamma): ${minGamma.toFixed(1)} to ${maxGamma.toFixed(1)} degrees`,
      `Shake/Percussion Count: ${shakeCount}`,
      `Average Beta: ${(betaValues.reduce((a, b) => a + b, 0) / (betaValues.length || 1)).toFixed(1)}`,
      `Average Gamma: ${(gammaValues.reduce((a, b) => a + b, 0) / (gammaValues.length || 1)).toFixed(1)}`,
    ].join('\n')

    try {
      const result = await callAIAgent(
        `Analyze this gesture-controlled music session:\n${summary}`,
        SESSION_ANALYZER_ID
      )
      if (result.success) {
        const data = result?.response?.result || {}
        setAnalysisResult({
          overall_score: typeof data.overall_score === 'number' ? data.overall_score : 0,
          summary: typeof data.summary === 'string' ? data.summary : extractText(result.response),
          rhythm_analysis: typeof data.rhythm_analysis === 'string' ? data.rhythm_analysis : '',
          expressiveness_rating: typeof data.expressiveness_rating === 'string' ? data.expressiveness_rating : '',
          pitch_analysis: typeof data.pitch_analysis === 'string' ? data.pitch_analysis : '',
          technique_notes: typeof data.technique_notes === 'string' ? data.technique_notes : '',
          suggestions: Array.isArray(data.suggestions) ? data.suggestions : [],
          session_highlights: Array.isArray(data.session_highlights) ? data.session_highlights : [],
        })
      } else {
        setAnalysisResult({
          overall_score: 0,
          summary: result?.error || 'Analysis failed. Please try again.',
          rhythm_analysis: '',
          expressiveness_rating: '',
          pitch_analysis: '',
          technique_notes: '',
          suggestions: [],
          session_highlights: [],
        })
      }
    } catch (_err) {
      setAnalysisResult({
        overall_score: 0,
        summary: 'An error occurred during analysis.',
        rhythm_analysis: '',
        expressiveness_rating: '',
        pitch_analysis: '',
        technique_notes: '',
        suggestions: [],
        session_highlights: [],
      })
    }
    setAnalysisLoading(false)
  }, [])

  return (
    <ErrorBoundary>
      <div className="min-h-screen flex flex-col" style={{ background: '#000000', color: 'white' }}>
        {/* Header */}
        <header
          className="px-4 py-3 border-b flex items-center justify-between"
          style={{ borderColor: 'rgba(255,255,255,0.06)', background: 'rgba(0,0,0,0.95)' }}
        >
          <div>
            <h1 className="text-xl font-black tracking-tight">
              <span style={{ color: '#ff1493' }}>Gesture</span>
              <span className="text-white">Synth</span>
            </h1>
            <p className="text-[10px] font-mono tracking-wider" style={{ color: '#00FFFF' }}>
              Camera-powered musical instrument
            </p>
          </div>
          <div className="flex items-center gap-3">
            {isRecording && (
              <div className="flex items-center gap-1.5">
                <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                <span className="text-xs text-red-400 font-bold font-mono">REC</span>
              </div>
            )}
            {cameraActive && (
              <div className="flex items-center gap-1.5">
                <div className="w-2 h-2 rounded-full animate-pulse" style={{ background: '#00ff00' }} />
                <span className="text-[10px] font-mono" style={{ color: '#00ff00' }}>LIVE</span>
              </div>
            )}
          </div>
        </header>

        {/* Content */}
        <main className="flex-1 overflow-y-auto">
          {activeTab === 'instrument' && (
            <CameraSection
              currentInstrument={currentInstrument}
              setCurrentInstrument={setCurrentInstrument}
              isPlaying={isPlaying}
              setIsPlaying={setIsPlaying}
              isRecording={isRecording}
              setIsRecording={setIsRecording}
              recordingRef={recordingRef}
              audioContextRef={audioContextRef}
              oscillatorRef={oscillatorRef}
              gainNodeRef={gainNodeRef}
              motionData={motionData}
              setMotionData={setMotionData}
              sessions={sessions}
              setSessions={setSessions}
              cameraActive={cameraActive}
              setCameraActive={setCameraActive}
            />
          )}
          {activeTab === 'recordings' && (
            <RecorderSection
              isRecording={isRecording}
              setIsRecording={setIsRecording}
              recordingRef={recordingRef}
              sessions={sessions}
              setSessions={setSessions}
              onAnalyze={handleAnalyze}
              motionEnabled={cameraActive}
            />
          )}
          {activeTab === 'analysis' && (
            <AnalyzerSection
              analysis={analysisResult}
              loading={analysisLoading}
              session={analyzedSession}
            />
          )}
        </main>

        {/* Bottom Navigation */}
        <nav
          className="fixed bottom-0 left-0 right-0 border-t safe-area-inset-bottom z-40"
          style={{
            borderColor: 'rgba(255,255,255,0.06)',
            background: 'rgba(0,0,0,0.95)',
            backdropFilter: 'blur(20px)',
          }}
        >
          <div className="flex">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className="flex-1 flex flex-col items-center gap-1 py-3 transition-colors"
                style={{
                  color: activeTab === tab.id ? '#ff1493' : '#4b5563',
                }}
              >
                <span className="text-lg">{tab.icon}</span>
                <span className="text-[10px] font-bold tracking-wider">{tab.label}</span>
              </button>
            ))}
          </div>
        </nav>

        {/* Guide floating panel (always available) */}
        <GuideSection />

        {/* Agent Status */}
        <div
          className="fixed bottom-20 left-4 right-4 z-30 pointer-events-none"
          style={{ display: analysisLoading ? 'block' : 'none' }}
        >
          <div
            className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs pointer-events-auto mx-auto max-w-xs font-mono"
            style={{ background: 'rgba(0,255,255,0.1)', border: '1px solid rgba(0,255,255,0.2)' }}
          >
            <div className="w-2 h-2 rounded-full animate-pulse" style={{ background: '#00FFFF' }} />
            <span style={{ color: '#00FFFF' }}>Session Analyzer processing...</span>
          </div>
        </div>
      </div>
    </ErrorBoundary>
  )
}

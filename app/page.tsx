'use client'

import React, { useState, useRef, useCallback } from 'react'
import { FaMusic, FaRecordVinyl, FaChartBar } from 'react-icons/fa'
import { callAIAgent, extractText } from '@/lib/aiAgent'
import InstrumentSection from './sections/InstrumentSection'
import type { MotionData, InstrumentType, MotionSnapshot } from './sections/InstrumentSection'
import GuideSection from './sections/GuideSection'
import RecorderSection from './sections/RecorderSection'
import type { RecordedSession } from './sections/RecorderSection'
import AnalyzerSection from './sections/AnalyzerSection'

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
        <div className="min-h-screen flex items-center justify-center" style={{ background: '#0a0a0f', color: 'white' }}>
          <div className="text-center p-8 max-w-md">
            <h2 className="text-xl font-semibold mb-2">Something went wrong</h2>
            <p className="text-gray-400 mb-4 text-sm">{this.state.error}</p>
            <button
              onClick={() => this.setState({ hasError: false, error: '' })}
              className="px-4 py-2 bg-purple-600 text-white rounded-md text-sm"
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
  { id: 'instrument', label: 'Instrument', icon: <FaMusic /> },
  { id: 'recordings', label: 'Recordings', icon: <FaRecordVinyl /> },
  { id: 'analysis', label: 'Analysis', icon: <FaChartBar /> },
]

export default function Page() {
  const [activeTab, setActiveTab] = useState<TabId>('instrument')

  // Instrument state
  const [motionEnabled, setMotionEnabled] = useState(false)
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
        `Analyze this gyroscope music session:\n${summary}`,
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
      <div className="min-h-screen flex flex-col" style={{ background: '#0a0a0f', color: 'white' }}>
        {/* Header */}
        <header
          className="px-4 py-3 border-b flex items-center justify-between"
          style={{ borderColor: 'rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.02)' }}
        >
          <div>
            <h1 className="text-xl font-bold tracking-tight">
              <span style={{ color: '#a855f7' }}>Gyro</span>
              <span className="text-white">Synth</span>
            </h1>
            <p className="text-xs text-gray-500">Motion-controlled instrument</p>
          </div>
          {isRecording && (
            <div className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
              <span className="text-xs text-red-400 font-medium">REC</span>
            </div>
          )}
        </header>

        {/* Content */}
        <main className="flex-1 overflow-y-auto">
          {activeTab === 'instrument' && (
            <InstrumentSection
              motionEnabled={motionEnabled}
              setMotionEnabled={setMotionEnabled}
              motionData={motionData}
              setMotionData={setMotionData}
              currentInstrument={currentInstrument}
              setCurrentInstrument={setCurrentInstrument}
              isPlaying={isPlaying}
              setIsPlaying={setIsPlaying}
              isRecording={isRecording}
              recordingRef={recordingRef}
              audioContextRef={audioContextRef}
              oscillatorRef={oscillatorRef}
              gainNodeRef={gainNodeRef}
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
              motionEnabled={motionEnabled}
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
          className="fixed bottom-0 left-0 right-0 border-t safe-area-inset-bottom"
          style={{
            borderColor: 'rgba(255,255,255,0.08)',
            background: 'rgba(10,10,15,0.95)',
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
                  color: activeTab === tab.id ? '#a855f7' : '#6b7280',
                }}
              >
                <span className="text-lg">{tab.icon}</span>
                <span className="text-[10px] font-medium">{tab.label}</span>
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
            className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs pointer-events-auto mx-auto max-w-xs"
            style={{ background: 'rgba(59,130,246,0.15)', border: '1px solid rgba(59,130,246,0.3)' }}
          >
            <div className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
            <span className="text-blue-300">Session Analyzer processing...</span>
          </div>
        </div>
      </div>
    </ErrorBoundary>
  )
}

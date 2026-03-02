'use client'

import React, { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { FaStar, FaArrowRight, FaChartBar, FaMusic } from 'react-icons/fa'
import type { RecordedSession } from './RecorderSection'

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

interface AnalyzerSectionProps {
  analysis: AnalysisResult | null
  loading: boolean
  session: RecordedSession | null
}

function ScoreCircle({ score }: { score: number }) {
  const radius = 50
  const circumference = 2 * Math.PI * radius
  const progress = (Math.min(Math.max(score, 0), 10) / 10) * circumference
  const scoreColor = score >= 7 ? '#22c55e' : score >= 4 ? '#f59e0b' : '#ef4444'

  return (
    <div className="relative flex items-center justify-center" style={{ width: 140, height: 140 }}>
      <svg width="140" height="140" viewBox="0 0 140 140" className="transform -rotate-90">
        <circle cx="70" cy="70" r={radius} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="8" />
        <circle
          cx="70" cy="70" r={radius} fill="none"
          stroke={scoreColor} strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference - progress}
          className="transition-all duration-1000"
        />
      </svg>
      <div className="absolute text-center">
        <div className="text-3xl font-bold text-white">{score}</div>
        <div className="text-xs text-gray-400">/10</div>
      </div>
    </div>
  )
}

function AnalysisSection({ title, content, icon }: { title: string; content: string; icon: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  if (!content) return null

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <button
          className="w-full flex items-center justify-between p-3 rounded-lg transition-colors hover:bg-white/5"
          style={{ background: 'rgba(255,255,255,0.03)' }}
        >
          <div className="flex items-center gap-2">
            <span className="text-purple-400">{icon}</span>
            <span className="text-sm font-medium text-white">{title}</span>
          </div>
          <span className="text-gray-500 text-xs">{open ? 'Hide' : 'Show'}</span>
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="px-3 py-2 text-sm text-gray-300 leading-relaxed">
          {content}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}

export default function AnalyzerSection({ analysis, loading, session }: AnalyzerSectionProps) {
  if (loading) {
    return (
      <div className="px-4 pb-24 pt-4 space-y-4">
        <Card className="border-0" style={{ background: 'rgba(255,255,255,0.05)' }}>
          <CardContent className="p-6 flex flex-col items-center gap-4">
            <Skeleton className="w-[140px] h-[140px] rounded-full" />
            <Skeleton className="h-4 w-48" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-3/4" />
          </CardContent>
        </Card>
        <Card className="border-0" style={{ background: 'rgba(255,255,255,0.05)' }}>
          <CardContent className="p-4 space-y-3">
            <Skeleton className="h-10 w-full rounded-lg" />
            <Skeleton className="h-10 w-full rounded-lg" />
            <Skeleton className="h-10 w-full rounded-lg" />
            <Skeleton className="h-10 w-full rounded-lg" />
          </CardContent>
        </Card>
      </div>
    )
  }

  if (!analysis) {
    return (
      <div className="px-4 pb-24 pt-4">
        <Card className="border-0" style={{ background: 'rgba(255,255,255,0.03)' }}>
          <CardContent className="p-12 text-center">
            <FaChartBar className="text-4xl text-gray-700 mx-auto mb-3" />
            <h3 className="text-white font-medium mb-1">No Analysis Yet</h3>
            <p className="text-gray-500 text-sm">
              Record a session and tap "Analyze" to get AI-powered feedback on your performance.
            </p>
          </CardContent>
        </Card>
      </div>
    )
  }

  const score = typeof analysis.overall_score === 'number' ? analysis.overall_score : 0
  const summary = typeof analysis.summary === 'string' ? analysis.summary : ''
  const suggestions = Array.isArray(analysis.suggestions) ? analysis.suggestions : []
  const highlights = Array.isArray(analysis.session_highlights) ? analysis.session_highlights : []
  const rhythmAnalysis = typeof analysis.rhythm_analysis === 'string' ? analysis.rhythm_analysis : ''
  const expressiveness = typeof analysis.expressiveness_rating === 'string' ? analysis.expressiveness_rating : ''
  const pitchAnalysis = typeof analysis.pitch_analysis === 'string' ? analysis.pitch_analysis : ''
  const techniqueNotes = typeof analysis.technique_notes === 'string' ? analysis.technique_notes : ''

  return (
    <div className="px-4 pb-24 pt-4 space-y-4">
      {/* Score Card */}
      <Card className="border-0" style={{ background: 'rgba(255,255,255,0.05)', backdropFilter: 'blur(12px)' }}>
        <CardContent className="p-6 flex flex-col items-center gap-4">
          <ScoreCircle score={score} />

          {session && (
            <div className="text-xs text-gray-500">
              Session from {new Date(session.startTime).toLocaleTimeString()} - {(session.duration / 1000).toFixed(0)}s
            </div>
          )}

          {summary && (
            <p className="text-sm text-gray-300 text-center leading-relaxed">{summary}</p>
          )}
        </CardContent>
      </Card>

      {/* Analysis Details */}
      <Card className="border-0" style={{ background: 'rgba(255,255,255,0.05)', backdropFilter: 'blur(12px)' }}>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm text-gray-400 uppercase tracking-wider">Detailed Analysis</CardTitle>
        </CardHeader>
        <CardContent className="p-4 space-y-2">
          <AnalysisSection title="Rhythm Analysis" content={rhythmAnalysis} icon={<FaMusic className="text-sm" />} />
          <AnalysisSection title="Expressiveness" content={expressiveness} icon={<FaStar className="text-sm" />} />
          <AnalysisSection title="Pitch Analysis" content={pitchAnalysis} icon={<FaChartBar className="text-sm" />} />
          <AnalysisSection title="Technique Notes" content={techniqueNotes} icon={<FaArrowRight className="text-sm" />} />
        </CardContent>
      </Card>

      {/* Suggestions */}
      {suggestions.length > 0 && (
        <Card className="border-0" style={{ background: 'rgba(255,255,255,0.05)', backdropFilter: 'blur(12px)' }}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-gray-400 uppercase tracking-wider">Suggestions</CardTitle>
          </CardHeader>
          <CardContent className="p-4 space-y-2">
            {suggestions.map((sug, idx) => (
              <div key={idx} className="flex items-start gap-3 p-3 rounded-lg" style={{ background: 'rgba(255,255,255,0.03)' }}>
                <FaArrowRight className="text-blue-400 text-xs mt-1.5 shrink-0" />
                <span className="text-sm text-gray-300">{sug}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Highlights */}
      {highlights.length > 0 && (
        <Card className="border-0" style={{ background: 'rgba(255,255,255,0.05)', backdropFilter: 'blur(12px)' }}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-gray-400 uppercase tracking-wider">Session Highlights</CardTitle>
          </CardHeader>
          <CardContent className="p-4 space-y-2">
            {highlights.map((hl, idx) => (
              <div key={idx} className="flex items-start gap-3 p-3 rounded-lg" style={{ background: 'rgba(255,255,255,0.03)' }}>
                <FaStar className="text-yellow-400 text-xs mt-1.5 shrink-0" />
                <span className="text-sm text-gray-300">{hl}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  )
}

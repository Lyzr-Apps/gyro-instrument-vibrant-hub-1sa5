'use client'

import React, { useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { FaQuestion, FaTimes, FaPaperPlane, FaLightbulb } from 'react-icons/fa'
import { callAIAgent, extractText } from '@/lib/aiAgent'

const GUIDE_AGENT_ID = '69a51ec08f619685109a6ccb'

interface GuideMessage {
  role: 'user' | 'agent'
  text: string
  tips?: string[]
  category?: string
}

export default function GuideSection() {
  const [isOpen, setIsOpen] = useState(false)
  const [messages, setMessages] = useState<GuideMessage[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSend = async () => {
    const question = input.trim()
    if (!question || loading) return

    setInput('')
    setMessages((prev) => [...prev, { role: 'user', text: question }])
    setLoading(true)

    try {
      const result = await callAIAgent(question, GUIDE_AGENT_ID)
      if (result.success) {
        const data = result?.response?.result || {}
        const answer = typeof data.answer === 'string' ? data.answer : extractText(result.response)
        const tips = Array.isArray(data.tips) ? data.tips : []
        const category = typeof data.category === 'string' ? data.category : 'general'
        setMessages((prev) => [
          ...prev,
          { role: 'agent', text: answer || 'No response received.', tips, category },
        ])
      } else {
        setMessages((prev) => [
          ...prev,
          { role: 'agent', text: result?.error || 'Failed to get a response. Please try again.' },
        ])
      }
    } catch (_err) {
      setMessages((prev) => [
        ...prev,
        { role: 'agent', text: 'An error occurred. Please try again.' },
      ])
    }
    setLoading(false)
  }

  return (
    <>
      {/* Floating button */}
      {!isOpen && (
        <button
          onClick={() => setIsOpen(true)}
          className="fixed bottom-24 right-4 z-50 w-14 h-14 rounded-full flex items-center justify-center shadow-xl transition-transform hover:scale-110"
          style={{ background: 'linear-gradient(135deg, #a855f7, #3b82f6)' }}
        >
          <FaQuestion className="text-white text-xl" />
        </button>
      )}

      {/* Chat Panel */}
      {isOpen && (
        <div className="fixed inset-0 z-50 flex flex-col" style={{ background: '#0a0a0f' }}>
          {/* Header */}
          <div
            className="flex items-center justify-between px-4 py-3 border-b"
            style={{ borderColor: 'rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.03)' }}
          >
            <div className="flex items-center gap-2">
              <FaQuestion className="text-purple-400" />
              <span className="font-semibold text-white">Instrument Guide</span>
            </div>
            <button onClick={() => setIsOpen(false)} className="text-gray-400 p-2">
              <FaTimes className="text-lg" />
            </button>
          </div>

          {/* Messages */}
          <ScrollArea className="flex-1 p-4">
            <div className="flex flex-col gap-3 max-w-lg mx-auto">
              {messages.length === 0 && (
                <div className="text-center py-12">
                  <FaQuestion className="text-4xl text-purple-400/30 mx-auto mb-3" />
                  <p className="text-gray-500 text-sm">
                    Ask about gestures, instruments, mappings, or troubleshooting.
                  </p>
                  <div className="flex flex-wrap gap-2 justify-center mt-4">
                    {['How does tilt control pitch?', 'What gestures are supported?', 'How to use drum mode?'].map((q) => (
                      <button
                        key={q}
                        onClick={() => { setInput(q); }}
                        className="text-xs px-3 py-2 rounded-lg text-gray-400 transition-colors hover:text-white"
                        style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)' }}
                      >
                        {q}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {messages.map((msg, idx) => (
                <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div
                    className="max-w-[85%] rounded-2xl px-4 py-3"
                    style={{
                      background: msg.role === 'user' ? '#a855f7' : 'rgba(255,255,255,0.08)',
                      borderBottomRightRadius: msg.role === 'user' ? 4 : 16,
                      borderBottomLeftRadius: msg.role === 'agent' ? 4 : 16,
                    }}
                  >
                    <p className="text-sm text-white whitespace-pre-wrap">{msg.text}</p>

                    {msg.role === 'agent' && Array.isArray(msg.tips) && msg.tips.length > 0 && (
                      <div className="mt-3 space-y-1.5 pt-2 border-t" style={{ borderColor: 'rgba(255,255,255,0.1)' }}>
                        {msg.tips.map((tip, tIdx) => (
                          <div key={tIdx} className="flex items-start gap-2">
                            <FaLightbulb className="text-yellow-400 text-xs mt-1 shrink-0" />
                            <span className="text-xs text-gray-300">{tip}</span>
                          </div>
                        ))}
                      </div>
                    )}

                    {msg.role === 'agent' && msg.category && (
                      <div className="mt-2">
                        <Badge variant="outline" className="text-xs capitalize" style={{ borderColor: 'rgba(168,85,247,0.5)', color: '#c084fc' }}>
                          {msg.category}
                        </Badge>
                      </div>
                    )}
                  </div>
                </div>
              ))}

              {loading && (
                <div className="flex justify-start">
                  <div className="rounded-2xl px-4 py-3" style={{ background: 'rgba(255,255,255,0.08)' }}>
                    <div className="flex gap-1.5">
                      <div className="w-2 h-2 rounded-full bg-purple-400 animate-bounce" style={{ animationDelay: '0ms' }} />
                      <div className="w-2 h-2 rounded-full bg-purple-400 animate-bounce" style={{ animationDelay: '150ms' }} />
                      <div className="w-2 h-2 rounded-full bg-purple-400 animate-bounce" style={{ animationDelay: '300ms' }} />
                    </div>
                  </div>
                </div>
              )}
            </div>
          </ScrollArea>

          {/* Input */}
          <div
            className="p-4 border-t"
            style={{ borderColor: 'rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.03)' }}
          >
            <div className="flex gap-2 max-w-lg mx-auto">
              <Input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSend()}
                placeholder="Ask about instruments..."
                className="flex-1 bg-transparent border text-white placeholder:text-gray-500"
                style={{ borderColor: 'rgba(255,255,255,0.15)' }}
                disabled={loading}
              />
              <Button
                onClick={handleSend}
                disabled={loading || !input.trim()}
                className="px-4"
                style={{ background: '#a855f7' }}
              >
                <FaPaperPlane />
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

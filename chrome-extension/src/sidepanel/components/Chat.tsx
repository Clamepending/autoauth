import { useState, useRef, useEffect } from 'react';
import { useStore } from '../store';
import { runAgentLoop } from '../agent/loop';
import MessageBubble from './MessageBubble';
import ToolStatus from './ToolStatus';
import { STORAGE_KEY_API_KEY } from '../../shared/constants';

export default function Chat() {
  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  const activeSessionId = useStore((s) => s.activeSessionId);
  const sessionInfo = useStore((s) => (activeSessionId ? s.sessionInfos[activeSessionId] : null));
  const messages = useStore((s) => (activeSessionId ? s.sessionStates[activeSessionId]?.messages ?? [] : []));
  const isRunning = useStore((s) => (activeSessionId ? s.sessionStates[activeSessionId]?.isRunning ?? false : false));
  const currentTool = useStore((s) => (activeSessionId ? s.sessionStates[activeSessionId]?.currentTool ?? null : null));
  const error = useStore((s) => (activeSessionId ? s.sessionStates[activeSessionId]?.error ?? null : null));

  const clearMessages = useStore((s) => s.clearMessages);
  const setIsRunning = useStore((s) => s.setIsRunning);
  const setApiKey = useStore((s) => s.setApiKey);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || isRunning || !activeSessionId) return;
    setInput('');
    try {
      await runAgentLoop(trimmed, activeSessionId);
    } catch (err) {
      console.error('Agent loop error:', err);
    }
  };

  const handleStop = () => {
    if (activeSessionId) setIsRunning(false, activeSessionId);
  };

  const handleClear = () => {
    if (activeSessionId) clearMessages(activeSessionId);
  };

  const handleLogout = () => {
    chrome.storage.local.remove(STORAGE_KEY_API_KEY);
    setApiKey(null);
    if (activeSessionId) clearMessages(activeSessionId);
  };

  const colorMap: Record<string, string> = {
    blue: 'bg-blue-100 text-blue-700',
    red: 'bg-red-100 text-red-700',
    yellow: 'bg-yellow-100 text-yellow-700',
    green: 'bg-green-100 text-green-700',
    pink: 'bg-pink-100 text-pink-700',
    purple: 'bg-purple-100 text-purple-700',
    cyan: 'bg-cyan-100 text-cyan-700',
    orange: 'bg-orange-100 text-orange-700',
  };
  const sessionColor = sessionInfo ? colorMap[sessionInfo.color] || 'bg-gray-100 text-gray-700' : '';

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-100 bg-white flex-shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 bg-orange-100 rounded-md flex items-center justify-center">
            <svg className="w-3.5 h-3.5 text-orange-600" fill="currentColor" viewBox="0 0 20 20">
              <path d="M10 2a8 8 0 100 16 8 8 0 000-16zm0 14.5a6.5 6.5 0 110-13 6.5 6.5 0 010 13z" />
            </svg>
          </div>
          <span className="text-sm font-medium text-gray-800">Claude Agent</span>
          {sessionInfo && (
            <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${sessionColor}`}>
              {sessionInfo.name}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={handleClear}
            className="p-1.5 text-gray-400 hover:text-gray-600 rounded transition-colors"
            title="Clear chat"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
            </svg>
          </button>
          <button
            onClick={handleLogout}
            className="p-1.5 text-gray-400 hover:text-gray-600 rounded transition-colors"
            title="Change API key"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m3 0l3-3m0 0l-3-3m3 3H9" />
            </svg>
          </button>
        </div>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto scrollbar-thin px-4 py-3 space-y-3">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <div className="w-12 h-12 bg-gray-100 rounded-full flex items-center justify-center mb-3">
              <svg className="w-6 h-6 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 017.843 4.582M12 3a8.997 8.997 0 00-7.843 4.582m15.686 0A11.953 11.953 0 0112 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0121 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0112 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 013 12c0-1.605.42-3.113 1.157-4.418" />
              </svg>
            </div>
            <p className="text-sm text-gray-500 font-medium">Ready to browse</p>
            <p className="text-xs text-gray-400 mt-1 max-w-[200px]">
              Tell me what you'd like to do and I'll control the browser for you.
            </p>
          </div>
        )}
        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}
        {isRunning && currentTool && <ToolStatus toolName={currentTool} />}
      </div>

      {/* Error */}
      {error && (
        <div className="mx-4 mb-2 px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-xs text-red-600">
          {error}
        </div>
      )}

      {/* Input */}
      <div className="px-3 pt-1 pb-[max(0.75rem,env(safe-area-inset-bottom))] border-t border-gray-100 bg-white flex-shrink-0">
        <form onSubmit={handleSubmit} className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={isRunning ? 'Agent is working...' : 'Ask Claude to do something...'}
            disabled={isRunning}
            className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent disabled:opacity-50 disabled:bg-gray-50 placeholder:text-gray-400"
            autoFocus
          />
          {isRunning ? (
            <button
              type="button"
              onClick={handleStop}
              className="px-3 py-2 bg-red-500 text-white rounded-lg text-sm font-medium hover:bg-red-600 transition-colors"
            >
              Stop
            </button>
          ) : (
            <button
              type="submit"
              disabled={!input.trim()}
              className="px-3 py-2 bg-orange-600 text-white rounded-lg text-sm font-medium hover:bg-orange-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Send
            </button>
          )}
        </form>
      </div>
    </div>
  );
}

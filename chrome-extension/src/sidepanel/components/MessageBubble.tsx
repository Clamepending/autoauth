import { useState } from 'react';
import type { DisplayMessage, DisplayBlock } from '../store';

export default function MessageBubble({ message }: { message: DisplayMessage }) {
  const isUser = message.role === 'user';

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[90%] rounded-xl px-3.5 py-2.5 text-sm ${
          isUser
            ? 'bg-orange-600 text-white'
            : 'bg-gray-100 text-gray-800'
        }`}
      >
        {message.blocks.map((block, i) => (
          <BlockRenderer key={i} block={block} isUser={isUser} />
        ))}
        {message.blocks.length === 0 && message.role === 'assistant' && (
          <div className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-pulse-dot" />
            <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-pulse-dot" style={{ animationDelay: '0.3s' }} />
            <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-pulse-dot" style={{ animationDelay: '0.6s' }} />
          </div>
        )}
      </div>
    </div>
  );
}

function BlockRenderer({ block, isUser }: { block: DisplayBlock; isUser: boolean }) {
  const [expanded, setExpanded] = useState(false);

  switch (block.type) {
    case 'text':
      return (
        <p className="whitespace-pre-wrap break-words leading-relaxed">{block.text}</p>
      );

    case 'tool_use':
      return (
        <div className={`mt-1.5 mb-1 rounded-lg text-xs ${isUser ? 'bg-orange-700/30' : 'bg-white border border-gray-200'}`}>
          <button
            onClick={() => setExpanded(!expanded)}
            className={`w-full flex items-center gap-2 px-2.5 py-1.5 ${isUser ? 'text-orange-100' : 'text-gray-600'}`}
          >
            <svg className={`w-3 h-3 transition-transform ${expanded ? 'rotate-90' : ''}`} fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z" clipRule="evenodd" />
            </svg>
            <span className="font-mono font-medium">{block.name}</span>
          </button>
          {expanded && (
            <pre className={`px-2.5 pb-2 overflow-x-auto ${isUser ? 'text-orange-100' : 'text-gray-500'}`}>
              {JSON.stringify(block.input, null, 2)}
            </pre>
          )}
        </div>
      );

    case 'tool_result':
      if (block.imageData) {
        return (
          <div className="mt-1.5 mb-1">
            <img
              src={`data:image/png;base64,${block.imageData}`}
              alt="Screenshot"
              className="rounded-lg border border-gray-200 max-w-full"
            />
          </div>
        );
      }
      if (block.text) {
        return (
          <details className="mt-1 mb-1 text-xs">
            <summary className={`cursor-pointer ${isUser ? 'text-orange-200' : 'text-gray-500'}`}>
              Tool result
            </summary>
            <pre className={`mt-1 overflow-x-auto max-h-40 ${isUser ? 'text-orange-100' : 'text-gray-500'}`}>
              {block.text.length > 2000 ? block.text.slice(0, 2000) + '...' : block.text}
            </pre>
          </details>
        );
      }
      return null;

    case 'screenshot':
      return (
        <div className="mt-1.5 mb-1">
          <img
            src={`data:image/png;base64,${block.data}`}
            alt="Screenshot"
            className="rounded-lg border border-gray-200 max-w-full"
          />
        </div>
      );

    default:
      return null;
  }
}

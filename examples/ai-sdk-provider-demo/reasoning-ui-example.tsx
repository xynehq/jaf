/**
 * Example: Rendering reasoning as a collapsible panel using AI SDK + React.
 *
 * This is a standalone snippet (not wired into a build). It demonstrates how to
 * use the new `callWithReasoning` to obtain `textStream`, `reasoningStream`, and
 * `fullStream`, and render reasoning behind a collapsible <details> panel.
 */

import React, { useEffect, useRef, useState } from 'react';
import { createOpenAI } from '@ai-sdk/openai';
import { callWithReasoning, type ReasoningOptions } from '@xynehq/jaf/adk';

export function ReasoningChatExample() {
  const openai = createOpenAI();
  const model = openai.chat('o3-mini');

  const [answer, setAnswer] = useState('');
  const [reasoning, setReasoning] = useState('');
  const [expanded, setExpanded] = useState(false);
  const running = useRef(false);

  async function onAsk(prompt: string) {
    if (running.current) return;
    running.current = true;
    setAnswer('');
    setReasoning('');

    const reasoningOpts: ReasoningOptions = { enabled: true, effort: 'medium', summary: 'auto' };
    const res = await callWithReasoning({
      provider: 'openai',
      model,
      prompt,
      reasoning: reasoningOpts,
      stream: true,
      store: false, // do not store model outputs
    });

    // stream answer
    (async () => {
      if (!res.textStream) return;
      for await (const delta of res.textStream) setAnswer((p) => p + delta);
    })();

    // stream reasoning
    (async () => {
      if (!res.reasoningStream) return;
      for await (const delta of res.reasoningStream) setReasoning((p) => p + delta);
    })();

    running.current = false;
  }

  return (
    <div style={{ fontFamily: 'system-ui', maxWidth: 720, margin: '2rem auto' }}>
      <h3>Reasoning demo</h3>
      <button onClick={() => onAsk('Explain why the sky is blue in 1-2 sentences.')}>Ask</button>

      <div style={{ marginTop: 16 }}>
        <strong>Answer</strong>
        <div style={{ padding: 12, background: '#f6f6f9', borderRadius: 6, minHeight: 48 }}>{answer}</div>
      </div>

      <details open={expanded} onToggle={(e) => setExpanded((e.target as HTMLDetailsElement).open)} style={{ marginTop: 16 }}>
        <summary style={{ cursor: 'pointer' }}>Show reasoning</summary>
        <pre style={{ whiteSpace: 'pre-wrap', padding: 12, background: '#f0f0f3', borderRadius: 6 }}>{reasoning}</pre>
      </details>
    </div>
  );
}

// Note: In a real app, you can replace the <details> panel with AI Elements
// components for richer UX once added to your project. For example, render
// reasoning deltas as a compact stream with timestamps and token counts.


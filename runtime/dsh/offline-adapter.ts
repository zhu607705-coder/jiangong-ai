import { LlmAdapter, ToolCallId, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'

/** A keyless engineering adapter. It dispatches tools, never supplies golden decisions. */
export class OfflineAdapter extends LlmAdapter {
  async resolveModel(provider: string, model: string) { return { provider, id: model, name: 'Offline engineering adapter (not an LLM)' } }
  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    if (options.signal?.aborted) throw new Error('aborted')
    const hasToolResult = options.messages.some(m => m.role === 'tool')
    const tool = options.tools?.find(t => t.name.startsWith('analyze_'))
    if (!hasToolResult && tool) {
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield { type: 'block-end', index: 0, block: { type: 'tool-call', id: ToolCallId(`offline-${tool.name}`), name: tool.name, arguments: '{}' } }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
    } else {
      const text = '离线能力检查已完成；这不是模型研判。'
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text }
      yield { type: 'block-end', index: 0, block: { type: 'text', text } }
      yield { type: 'finish', reason: { kind: 'stop' } }
    }
  }
}

// Scripted external process: exercises the real parent IPC, not a model or SDK mock.
import { spawn } from 'node:child_process';
import { WorkerJob, ToolReply } from '../../src/agents/copilot/wire.js';

let replies = 0;
let mode = '';
let text = '';
process.on('message', (raw: unknown) => {
  const job = WorkerJob.safeParse(raw);
  if (job.success) {
    mode = job.data.prompt;
    text = `${job.data.resume ?? 'fresh'}:${mode}`;
    process.send?.({ type: 'session', id: 'external-session' });
    if (mode === 'crash') { process.exitCode = 7; process.disconnect(); return; }
    if (mode === 'invalid') { process.send?.({ type: 'invalid' }); return; }
    if (mode === 'limit') {
      for (let i = 0; i < 3; i++) process.send?.({ type: 'event', event: { kind: 'turn' } });
      return;
    }
    if (mode === 'hold') {
      const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
      process.send?.({ type: 'event', event: { kind: 'text', text: `owned child ${child.pid}` } });
      return;
    }
    const call = { type: 'tool', id: 'domain', sessionId: 'external-session', name: 'mcp__agentcraft__report_status', args: { state: 'reading', activity: 'from IPC' } };
    process.send?.(call);
    process.send?.(call);
    process.send?.({ type: 'tool', id: 'write', sessionId: 'external-session', name: 'Write', args: { file_path: 'denied.txt', content: 'unapproved' } });
    return;
  }
  if (ToolReply.safeParse(raw).success && ++replies === 3) {
    process.send?.({ type: 'done', text }, () => process.disconnect());
  }
  if (raw && typeof raw === 'object' && 'type' in raw && raw.type === 'stop' && mode !== 'hold') process.disconnect();
});

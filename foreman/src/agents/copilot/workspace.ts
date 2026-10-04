import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import type { RunRequest } from '../runtime.js';
import type { TeamTool, ToolResult } from '../tools.js';
import { runShell } from '../../util/proc.js';
import { tailLines } from '../../util/text.js';
import { copilotEnv } from './environment.js';

const text = (value: string, isError = false): ToolResult => ({
  content: [{ type: 'text', text: value }], ...(isError ? { isError: true } : {}),
});

export function buildWorkspaceTools(r: RunRequest): TeamTool[] {
  function define<S extends z.ZodRawShape>(name: string, description: string, shape: S, execute: (args: z.infer<z.ZodObject<S>>) => Promise<ToolResult>): TeamTool {
    const schema = z.object(shape);
    return {
      name, description, schema,
      handler: async (args) => {
        const input = schema.parse(args);
        if (r.turn.signal.aborted) return text('Turn stopped; nothing was changed.', true);
        const verdict = await r.authorize(name, input, { signal: r.turn.signal });
        if (verdict.behavior !== 'allow') return text(verdict.message, true);
        if (r.turn.signal.aborted) return text('Turn stopped; nothing was changed.', true);
        return execute(schema.parse(verdict.updatedInput));
      },
    };
  }
  const resolve = (file: string) => path.resolve(r.cwd, file);
  const tools: TeamTool[] = [
    define('Read', 'Read a UTF-8 file. offset is a 1-based line number.', {
      file_path: z.string(), offset: z.number().int().positive().optional(), limit: z.number().int().min(1).max(2000).optional(),
    }, async (a) => {
      const file = resolve(a.file_path);
      if (fs.statSync(file).size > 2 * 1024 * 1024) return text('File exceeds 2 MiB; use a smaller file or a scoped shell command.', true);
      const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
      const start = (a.offset ?? 1) - 1;
      return text(lines.slice(start, start + (a.limit ?? 500)).map((line, i) => `${start + i + 1}\t${line}`).join('\n'));
    }),
    define('Glob', 'Find relative file paths. Excludes git internals and dependency directories.', {
      pattern: z.string(), path: z.string().optional(),
    }, async (a) => {
      const cwd = resolve(a.path ?? '.');
      return text(fs.globSync(a.pattern, { cwd, exclude: ['**/.git/**', '**/node_modules/**'] }).slice(0, 500).join('\n'));
    }),
    define('Grep', 'Search UTF-8 files using a JavaScript regular expression; glob defaults to **/*.', {
      pattern: z.string(), path: z.string().optional(), glob: z.string().optional(),
    }, async (a) => {
      const cwd = resolve(a.path ?? '.');
      const regex = new RegExp(a.pattern);
      const files = fs.statSync(cwd).isFile() ? [cwd] : fs.globSync(a.glob ?? '**/*', { cwd, exclude: ['**/.git/**', '**/node_modules/**'] }).map((f) => path.resolve(cwd, f));
      const out: string[] = [];
      for (const file of files.slice(0, 5000)) {
        if (r.turn.signal.aborted) return text('Search stopped.', true);
        const stat = fs.statSync(file);
        if (!stat.isFile() || stat.size > 2 * 1024 * 1024) continue;
        const permitted = await r.authorize('Read', { file_path: file }, { signal: r.turn.signal });
        if (permitted.behavior !== 'allow') return text(permitted.message, true);
        if (r.turn.signal.aborted) return text('Search stopped.', true);
        const contents = fs.readFileSync(file, 'utf8');
        if (contents.includes('\0')) continue;
        contents.split(/\r?\n/).forEach((line, i) => {
          if (out.length < 500 && regex.test(line)) out.push(`${path.relative(r.cwd, file)}:${i + 1}:${line.slice(0, 500)}`);
        });
        if (out.length >= 500) break;
      }
      return text(out.join('\n') || 'No matches.');
    }),
  ];
  if (r.role === 'worker') {
    tools.push(
      define('Write', 'Write a UTF-8 file inside your worktree.', { file_path: z.string(), content: z.string().max(2 * 1024 * 1024) }, async (a) => {
        const file = resolve(a.file_path);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, a.content, 'utf8');
        return text('File written.');
      }),
      define('Edit', 'Replace exact text in a UTF-8 file; ambiguous matches require replace_all.', {
        file_path: z.string(), old_string: z.string().min(1), new_string: z.string(), replace_all: z.boolean().optional(),
      }, async (a) => {
        const file = resolve(a.file_path);
        const before = fs.readFileSync(file, 'utf8');
        const matches = before.split(a.old_string).length - 1;
        if (matches === 0 || (matches > 1 && !a.replace_all)) return text(`Expected one match, found ${matches}; nothing changed.`, true);
        fs.writeFileSync(file, a.replace_all ? before.split(a.old_string).join(a.new_string) : before.replace(a.old_string, a.new_string), 'utf8');
        return text('File updated.');
      }),
      define('Bash', 'Run a command in your worktree using the platform shell (cmd.exe on Windows).', { command: z.string().min(1) }, async (a) => {
        const result = await runShell(a.command, {
          cwd: r.cwd, timeoutMs: 300_000, signal: r.turn.signal,
          env: copilotEnv(process.env, r.cwd, r.agentId, false),
        });
        const full = `${result.stdout}\n${result.stderr}`;
        const output = tailLines(full, 100, 12000);
        return text(`${result.truncated || output.length < full.trimEnd().length ? '[output clipped]\n' : ''}${output}\nexit: ${result.code}${result.timedOut ? ' (timed out)' : ''}`, result.code !== 0 || result.timedOut || r.turn.signal.aborted);
      }),
    );
  }
  return tools;
}

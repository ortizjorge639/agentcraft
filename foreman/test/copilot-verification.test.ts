import fs from 'node:fs';
import path from 'node:path';
import { expect, it } from 'vitest';
import { demoRepo, makeForeman, tempDir, rmrf } from './helpers.js';

it('fingerprints untracked contents and refuses truncated tracked diffs', async () => {
  const home = tempDir();
  const repo = await demoRepo();
  const h = makeForeman(home, ['--backend', 'copilot']);
  try {
    const registered = await h.fm.repos.add(repo);
    const revision = () => h.fm.repos.verificationRevision(registered.id);
    const before = await revision();
    fs.writeFileSync(path.join(repo, 'new.txt'), 'one');
    const first = await revision();
    expect(first).not.toBe(before);
    fs.writeFileSync(path.join(repo, 'new.txt'), 'two');
    expect(await revision()).not.toBe(first);
    fs.appendFileSync(path.join(repo, 'README.md'), 'large change\n'.repeat(800_000));
    await expect(revision()).rejects.toThrow(/incomplete fingerprint/);
  } finally {
    await h.fm.close();
    rmrf(home);
    rmrf(path.dirname(repo));
  }
});

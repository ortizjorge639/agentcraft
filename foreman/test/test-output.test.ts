import { expect, it } from 'vitest';
import { parseTestOutput } from '../src/repos.js';

it('reports a Node spec summary as well as TAP across supported Node versions', () => {
  expect(parseTestOutput('ℹ tests 10\nℹ pass 9\nℹ fail 1\n✖ rejects invalid input\n')).toEqual({
    summary: 'tests 10, pass 9, fail 1', failures: ['rejects invalid input'],
  });
});

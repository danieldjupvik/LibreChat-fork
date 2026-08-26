const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '../../../..');
/** Active source only: the parked snapshot lives under `.fork/parked`, and this
 *  spec is excluded because it necessarily names every string it forbids. */
const activePaths = [
  'api',
  'client/src',
  'packages',
  ':(exclude)api/server/forked-code/litellm/responseCostRemoved.spec.js',
];

const readActive = (relativePath) => fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');

const grepActive = (pattern) => {
  try {
    return execFileSync('git', ['grep', '-l', '-F', pattern, '--', ...activePaths], {
      cwd: repoRoot,
      encoding: 'utf8',
    })
      .split('\n')
      .filter(Boolean);
  } catch (error) {
    /** git grep exits 1 with no output when nothing matches */
    if (error.status === 1 && !error.stdout) {
      return [];
    }
    throw error;
  }
};

/**
 * ACTIVE guard, not parked code — it has to run in CI to be worth anything.
 *
 * The fork's old custom response-cost feature is parked under
 * `.fork/parked/litellm-response-cost/`. These assertions fail loudly if any of
 * it is wired back into active code by accident (e.g. an upstream merge
 * resurrecting a call site), and guard the native usage path it was replaced by.
 * Restoring the parked feature means deleting this file.
 */
describe('LiteLLM response-cost feature is removed from active code', () => {
  it('has no active syncResponseUsage call or module', () => {
    expect(grepActive('syncResponseUsage')).toEqual([]);
    expect(
      fs.existsSync(path.join(repoRoot, 'api/server/forked-code/agents/syncResponseUsage.js')),
    ).toBe(false);
  });

  it('has no active read or write of metadata.forked_litellm_usage', () => {
    expect(grepActive('forked_litellm_usage')).toEqual([]);
  });

  it('has no active ResponseCost import or mount', () => {
    expect(grepActive('ResponseCost')).toEqual([]);
    expect(readActive('client/src/components/Chat/Messages/HoverButtons.tsx')).not.toContain(
      'ResponseCost',
    );
  });

  it('no longer exposes the browser-side LiteLLM pricing proxy', () => {
    expect(grepActive('/api/forked/litellm/model-info')).toEqual([]);
    expect(readActive('api/server/forked-code/routes/index.js')).not.toContain('litellm');
  });

  it('keeps the LiteLLM usage-normalization hooks the native pipeline depends on', () => {
    const client = readActive('api/server/controllers/agents/client.js');
    expect(client).toContain('applyLiteLLMStreamUsage(');
    expect(client).toContain('preserveLiteLLMUsage(');
  });

  it('keeps the native metadata.usage persistence path intact', () => {
    expect(readActive('api/server/controllers/agents/client.js')).toContain(
      'metadata.usage = usage;',
    );
  });
});

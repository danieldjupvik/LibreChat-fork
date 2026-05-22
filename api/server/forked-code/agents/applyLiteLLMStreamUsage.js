const isLiteLLMEndpoint = (endpoint) =>
  typeof endpoint === 'string' && endpoint.toLowerCase().includes('litellm');

const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

const optInAgent = (agent) => {
  if (!agent || !isLiteLLMEndpoint(agent.endpoint)) {
    return;
  }
  const params = agent.model_parameters ?? {};
  if (hasOwn(params, 'streamUsage')) {
    return;
  }
  agent.model_parameters = { ...params, streamUsage: true };
};

/**
 * LiteLLM forwards token usage in streamed chunks, but upstream's default for
 * Custom Endpoints is to disable streamUsage and rely on a follow-up
 * non-streamed call. Opt LiteLLM-endpoint agents into streaming usage via the
 * upstream-supported `model_parameters.streamUsage` field, so vanilla
 * `createRun` reads the opt-in and skips the disable path.
 *
 * Walks `subagentAgentConfigs` recursively so delegated LiteLLM subagents
 * (which are pruned out of the top-level `agents` array passed to
 * `createRun`) also get the opt-in. Visited set guards against cycles in a
 * malformed agent graph.
 */
const applyLiteLLMStreamUsage = (agents) => {
  if (!Array.isArray(agents)) {
    return;
  }
  const visited = new Set();
  const queue = [];
  for (const agent of agents) {
    if (agent) queue.push(agent);
  }
  while (queue.length > 0) {
    const agent = queue.shift();
    if (visited.has(agent)) {
      continue;
    }
    visited.add(agent);
    optInAgent(agent);
    if (Array.isArray(agent.subagentAgentConfigs)) {
      for (const child of agent.subagentAgentConfigs) {
        if (child && !visited.has(child)) queue.push(child);
      }
    }
  }
};

module.exports = { applyLiteLLMStreamUsage };

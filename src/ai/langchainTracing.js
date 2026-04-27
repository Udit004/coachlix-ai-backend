import { RunnableLambda } from '@langchain/core/runnables';
import { LangChainTracer } from '@langchain/core/tracers/tracer_langchain';

import { env } from '../config/env.js';

let tracer = null;

function getTracer() {
  if (!env.langchainApiKey || !env.langchainTracingV2) {
    return null;
  }

  if (!tracer) {
    tracer = new LangChainTracer({
      projectName: env.langchainProject
    });
  }

  return tracer;
}

const sessionEventRunnable = RunnableLambda.from(async (input) => input);

export async function traceLiveEvent(eventName, payload = {}) {
  const activeTracer = getTracer();
  if (!activeTracer) {
    return;
  }

  await sessionEventRunnable.invoke(
    {
      eventName,
      ts: new Date().toISOString(),
      payload
    },
    {
      callbacks: [activeTracer],
      runName: `live_voice_${eventName}`
    }
  );
}

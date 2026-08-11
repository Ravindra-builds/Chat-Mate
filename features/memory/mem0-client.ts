import { MemoryClient } from "mem0ai";

export const isMem0Configured = Boolean(process.env.MEM0_API_KEY);

if (!isMem0Configured) {
  console.warn(
    "[memory] MEM0_API_KEY not set — long-term memory is disabled. Chat still works normally.",
  );
}

export const mem0 = isMem0Configured
  ? new MemoryClient({ apiKey: process.env.MEM0_API_KEY! })
  : null;

import { defineAgent } from "eve";
import { createGroq } from "@ai-sdk/groq";

const groq = createGroq({
  apiKey: process.env.GROQ_API_KEY?.trim(),
});

const modelId = process.env.GROQ_MODEL?.trim() || "openai/gpt-oss-120b";

export default defineAgent({
  model: groq(modelId),
  modelContextWindowTokens: 131_072,
  compaction: {
    modelContextWindowTokens: 131_072,
  },
});

import { defineAgent } from "eve";
import { createGroq } from "@ai-sdk/groq";

const groq = createGroq({
  apiKey: process.env.GROQ_API_KEY?.trim(),
});

export default defineAgent({
  model: groq("llama-3.3-70b-versatile"),
  modelContextWindowTokens: 131_072,
  compaction: {
    modelContextWindowTokens: 131_072,
  },
});

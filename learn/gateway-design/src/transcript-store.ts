import { loadLearningTranscript } from "../../agent-design/src/index.js";

export async function loadGatewayTranscript(sessionId: string, dataDir: string) {
  return await loadLearningTranscript(sessionId, dataDir);
}

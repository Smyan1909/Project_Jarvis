import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { handleSpeechRoutes } from "./routes/speech.js";

const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  // Set CORS headers for mobile app
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  // Handle preflight requests
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  // Try speech routes
  const handledBySpeech = await handleSpeechRoutes(req, res);
  if (handledBySpeech) {
    return;
  }

  // Default health check endpoint
  if (req.url === "/api/health" || req.url === "/") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ status: "ok" }));
    return;
  }

  // 404 for unhandled routes
  res.writeHead(404, { "content-type": "application/json" });
  res.end(JSON.stringify({ error: "Not found" }));
});

server.listen(3000, () => {
  // eslint-disable-next-line no-console
  console.log("Backend listening on http://localhost:3000");
});

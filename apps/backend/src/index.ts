import { createServer } from "node:http";

const server = createServer((req, res) => {
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({ status: "ok" }));
});

server.listen(3000, () => {
  // eslint-disable-next-line no-console
  console.log("Backend listening on http://localhost:3000");
});

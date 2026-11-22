// Reading a request's body and sending a JSON answer.

import type { IncomingMessage, ServerResponse } from "node:http";

export function body(req: IncomingMessage): Promise<string> {
  return new Promise((ok, fail) => {
    let raw = "";
    req.on("data", (c: Buffer) => (raw += c));
    req.on("end", () => ok(raw));
    req.on("error", fail);
  });
}

export function reply(res: ServerResponse, code: number, data: object) {
  res.statusCode = code;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(data));
}

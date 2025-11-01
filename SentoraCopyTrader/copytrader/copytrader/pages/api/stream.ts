import { addClient, removeClient } from "../../lib/logger";

export default function handler(req: any, res: any) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });

  // keep socket alive
  res.socket?.setKeepAlive?.(true);
  res.socket?.setNoDelay?.(true);
  res.socket?.setTimeout?.(0);

  // flush headers immediately
  res.flushHeaders?.();

  // initial handshake
  res.write("retry: 10000\n");
  res.write(": connected\n\n");

  addClient(res);

  const cleanup = () => removeClient(res);
  req.on("close", cleanup);
  req.on("end", cleanup);
  req.on("error", cleanup);
}

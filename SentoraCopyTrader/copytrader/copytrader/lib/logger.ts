// ensure global singleton
const g: any = globalThis as any;

if (!g.__SENTORA_LOGGER__) {
  g.__SENTORA_LOGGER__ = {
    clients: [] as any[],

    pushLog(msg: string) {
      const line = `${new Date().toLocaleTimeString()} — ${msg}`;
      // send to all SSE clients
      for (const res of g.__SENTORA_LOGGER__.clients) {
        try {
          res.write(`data: ${line}\n\n`);
        } catch {
          // drop broken client
        }
      }
      console.log(line); // still log to terminal
    },

    addClient(res: any) {
      g.__SENTORA_LOGGER__.clients.push(res);
      // welcome message to confirm stream works
      try {
        res.write(`data: ${new Date().toLocaleTimeString()} — 🔗 Log stream connected\n\n`);
      } catch {}
    },

    removeClient(res: any) {
      g.__SENTORA_LOGGER__.clients = g.__SENTORA_LOGGER__.clients.filter((c: any) => c !== res);
      try {
        res.end?.();
      } catch {}
    },
  };

  // keep-alive ping every 20s
  g.__SENTORA_LOGGER__.__interval__ = setInterval(() => {
    for (const res of g.__SENTORA_LOGGER__.clients) {
      try {
        res.write(`: keep-alive ${Date.now()}\n\n`);
      } catch {}
    }
  }, 20000);
}

export const { pushLog, addClient, removeClient } = g.__SENTORA_LOGGER__;

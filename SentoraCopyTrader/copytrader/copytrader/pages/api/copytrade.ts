// pages/api/copytrade.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { startCopyTrader, stopCopyTrader } from "../../lib/copytrader";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Only POST allowed" });

  const { action } = req.body || {};

  try {
    if (action === "start") {
      const { targetWallet, solAmount, copySells } = req.body;
      if (!targetWallet || !solAmount) return res.status(400).json({ error: "Missing targetWallet/solAmount" });

      // start (non-blocking)
      startCopyTrader(targetWallet, parseFloat(solAmount), Boolean(copySells));
      return res.status(200).json({ message: `✅ Bot started for ${targetWallet}` });
    }

    if (action === "stop") {
      await stopCopyTrader();
      return res.status(200).json({ message: "🛑 Bot stopped" });
    }

    return res.status(400).json({ error: "Invalid action" });
  } catch (err: any) {
    console.error("copytrade api error:", err);
    return res.status(500).json({ error: err.message || "Internal error" });
  }
}

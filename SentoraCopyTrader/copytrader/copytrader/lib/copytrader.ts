// lib/copytrader.ts
import { Connection, PublicKey, Keypair, VersionedTransaction } from "@solana/web3.js";
import bs58 from "bs58";
import { AccountLayout } from "@solana/spl-token";
import { pushLog } from "./logger";

// ---------- GLOBAL SINGLETON (persists across API hits/hot reload) ----------
type BotState = {
  running: boolean;
  subId: number | null;
  connection: Connection | null;
  inflight: Set<AbortController>; // abortable network calls
};
const G: any = globalThis as any;
if (!G.__COPY_BOT__) {
  G.__COPY_BOT__ = { running: false, subId: null, connection: null, inflight: new Set<AbortController>() } as BotState;
}
const BOT = G.__COPY_BOT__ as BotState;

// ---------- Config ----------
const RPC_URL =
  process.env.HELIUS_RPC_URL ||
  process.env.RPC_URL ||
  "https://api.mainnet-beta.solana.com";

const WSOL = "So11111111111111111111111111111111111111112";

// ---------- Wallet ----------
function loadKeypair(secret: string) {
  if (!secret) throw new Error("No PRIVATE_KEY provided");
  if (!secret.includes(",") && secret.trim().length > 40) {
    return Keypair.fromSecretKey(bs58.decode(secret.trim()));
  }
  const arr = JSON.parse(secret);
  return Keypair.fromSecretKey(Uint8Array.from(arr));
}
const owner = loadKeypair(process.env.PRIVATE_KEY || "");

// ---------- Abortable fetch helper ----------
function abortableFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  const controller = new AbortController();
  init.signal = controller.signal;
  BOT.inflight.add(controller);
  const p = fetch(input, init)
    .finally(() => BOT.inflight.delete(controller));
  return { promise: p, controller };
}

// ---------- Helpers ----------
async function fetchParsedTx(sig: string) {
  if (!BOT.connection) return null;
  return await BOT.connection.getParsedTransaction(sig, {
    commitment: "confirmed",
    maxSupportedTransactionVersion: 0,
  });
}

function getBuysForTarget(parsedTx: any, targetStr: string) {
  if (!parsedTx?.meta) return [];
  const pre = (parsedTx.meta.preTokenBalances || []) as any[];
  const post = (parsedTx.meta.postTokenBalances || []) as any[];
  const key = (tb: any) => `${tb.accountIndex}:${tb.mint}:${tb.owner}`;
  const preMap = new Map(pre.map((tb: any) => [key(tb), tb]));
  const buys: any[] = [];
  for (const p of post) {
    if (p.owner !== targetStr) continue;
    const k = key(p);
    const before = preMap.get(k);
    const postAmt = Number(p.uiTokenAmount?.amount || 0);
    const preAmt = before ? Number(before.uiTokenAmount?.amount || 0) : 0;
    const diff = postAmt - preAmt;
    if (diff > 0 && p.mint !== WSOL) {
      buys.push({
        mint: p.mint,
        decimals: Number(p.uiTokenAmount?.decimals || 0),
        rawIncrease: diff,
      });
    }
  }
  return buys;
}

function getSellsForTarget(parsedTx: any, targetStr: string) {
  if (!parsedTx?.meta) return [];
  const pre = (parsedTx.meta.preTokenBalances || []) as any[];
  const post = (parsedTx.meta.postTokenBalances || []) as any[];
  const key = (tb: any) => `${tb.accountIndex}:${tb.mint}:${tb.owner}`;
  const postMap = new Map(post.map((tb: any) => [key(tb), tb]));
  const sells: any[] = [];
  for (const p of pre) {
    if (p.owner !== targetStr) continue;
    const k = key(p);
    const after = postMap.get(k);
    const preAmt = Number(p.uiTokenAmount?.amount || 0);
    const postAmt = after ? Number(after.uiTokenAmount?.amount || 0) : 0;
    const diff = preAmt - postAmt;
    if (diff > 0 && p.mint !== WSOL) {
      sells.push({
        mint: p.mint,
        decimals: Number(p.uiTokenAmount?.decimals || 0),
        rawDecrease: diff,
      });
    }
  }
  return sells;
}

async function getJupQuote({
  inputMint,
  outputMint,
  amountLamports,
  slippageBps,
}: {
  inputMint: string;
  outputMint: string;
  amountLamports: number;
  slippageBps: number;
}) {
  const url = new URL("https://quote-api.jup.ag/v6/quote");
  url.searchParams.set("inputMint", inputMint);
  url.searchParams.set("outputMint", outputMint);
  url.searchParams.set("amount", String(amountLamports));
  url.searchParams.set("slippageBps", String(slippageBps));
  url.searchParams.set("onlyDirectRoutes", "false");

  const { promise } = abortableFetch(url.toString());
  const res = await promise;
  if (!res.ok) throw new Error(`Jupiter quote failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  if (!data || !data.outAmount) throw new Error("No routes returned by Jupiter");
  return data;
}

async function buildJupSwapTx({ quoteResponse, userPublicKey }: any) {
  const { promise } = abortableFetch("https://quote-api.jup.ag/v6/swap", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      quoteResponse,
      userPublicKey,
      wrapAndUnwrapSol: true,
      asLegacyTransaction: false,
    }),
  });
  const res = await promise;
  if (!res.ok) throw new Error(`Jupiter swap build failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  if (!data.swapTransaction) throw new Error("No swapTransaction in Jupiter response");
  return data.swapTransaction; // base64
}

async function executeBase64Tx(base64Tx: string, payer: Keypair) {
  if (!BOT.connection) throw new Error("No active connection");
  const txBuf = Buffer.from(base64Tx, "base64");
  const vtx = VersionedTransaction.deserialize(txBuf);
  vtx.sign([payer]);
  const sig = await BOT.connection.sendRawTransaction(vtx.serialize(), {
    skipPreflight: false,
  });
  const conf = await BOT.connection.confirmTransaction(sig, "confirmed");
  if (conf?.value?.err) throw new Error(`Swap tx error: ${JSON.stringify(conf.value.err)}`);
  return sig;
}

// ---------- Copy actions ----------
async function copySell(mint: string, decimals: number, slippageBps: number) {
  if (!BOT.running || !BOT.connection) {
    pushLog("⏹️ Skipped sell (bot stopped).");
    return;
  }

  const tokenAccounts = await BOT.connection.getTokenAccountsByOwner(owner.publicKey, {
    mint: new PublicKey(mint),
  });

  if (tokenAccounts.value.length === 0) {
    pushLog(`⚠️ No ${mint} balance to sell`);
    return;
  }

  const rawAccount = tokenAccounts.value[0].account.data;
  const accountData = AccountLayout.decode(rawAccount);
  const balance = Number(accountData.amount);
  const tokenAmount = balance / 10 ** decimals;

  if (balance <= 0) {
    pushLog(`⚠️ Not enough balance of ${mint} to sell`);
    return;
  }

  const amountRaw = Math.floor(balance * 0.99); // sell ~99%
  pushLog(`🔄 Selling ALL: ${tokenAmount} of ${mint} into SOL`);

  try {
    const quote = await getJupQuote({
      inputMint: mint,
      outputMint: WSOL,
      amountLamports: amountRaw,
      slippageBps,
    });
    if (!BOT.running) return;

    pushLog(`📊 Got Jupiter sell quote for ${mint}`);

    const swapTxB64 = await buildJupSwapTx({
      quoteResponse: quote,
      userPublicKey: owner.publicKey.toBase58(),
    });
    if (!BOT.running) return;

    pushLog(`⚙️ Built sell transaction for ${mint}`);

    const sig = await executeBase64Tx(swapTxB64, owner);
    pushLog(`✅ Sold ALL of ${mint}. Tx: https://solscan.io/tx/${sig}`);
  } catch (e: any) {
    if (e?.name === "AbortError") {
      pushLog(`⛔ Sell aborted for ${mint}`);
      return;
    }
    pushLog(`❌ Sell error for ${mint}: ${e.message}`);
  }
}

async function copyBuy(mint: string, solAmount: number, slippageBps: number) {
  if (!BOT.running) {
    pushLog("⏹️ Skipped buy (bot stopped).");
    return;
  }

  const amountLamports = Math.round(solAmount * 1e9);
  pushLog(`🔍 Detected buy: preparing to swap ${solAmount} SOL into ${mint}`);

  try {
    const quote = await getJupQuote({
      inputMint: WSOL,
      outputMint: mint,
      amountLamports,
      slippageBps,
    });
    if (!BOT.running) return;

    pushLog(`📊 Got Jupiter quote for ${mint}`);

    const swapTxB64 = await buildJupSwapTx({
      quoteResponse: quote,
      userPublicKey: owner.publicKey.toBase58(),
    });
    if (!BOT.running) return;

    pushLog(`⚙️ Built swap transaction for ${mint}`);

    const sig = await executeBase64Tx(swapTxB64, owner);
    pushLog(`✅ Copied buy! Swapped ${solAmount} SOL into ${mint}. Tx: https://solscan.io/tx/${sig}`);
  } catch (e: any) {
    if (e?.name === "AbortError") {
      pushLog(`⛔ Buy aborted for ${mint}`);
      return;
    }
    pushLog(`❌ Copy error for ${mint}: ${e.message}`);
  }
}

// ---------- exported controls ----------
export async function startCopyTrader(
  targetWallet: string,
  solAmount: number,
  copySells = false,
  slippageBps = 100
) {
  await stopCopyTrader(); // hard reset before starting

  BOT.running = true;
  BOT.connection = new Connection(RPC_URL, "confirmed");

  const TARGET = new PublicKey(targetWallet);
  pushLog(`🚀 CopyTrader started for ${TARGET.toBase58()} with ${solAmount} SOL (copy sells: ${copySells})`);

  BOT.subId = await BOT.connection.onLogs(TARGET, async (logInfo) => {
    if (!BOT.running) return;

    try {
      const sig = logInfo.signature;
      const tx = await fetchParsedTx(sig);
      if (!BOT.running) return;

      // buys
      const buys = getBuysForTarget(tx, TARGET.toBase58());
      for (const b of buys) {
        if (!BOT.running) break;
        pushLog(`🚨 Target bought token: ${b.mint} (+${b.rawIncrease / 10 ** b.decimals})`);
        await copyBuy(b.mint, solAmount, slippageBps);
      }

      // sells
      if (copySells) {
        const sells = getSellsForTarget(tx, TARGET.toBase58());
        for (const s of sells) {
          if (!BOT.running) break;
          pushLog(`⚠️ Target sold token: ${s.mint}`);
          await copySell(s.mint, s.decimals, slippageBps);
        }
      }
    } catch (e: any) {
      pushLog(`⚠️ Subscription error: ${e.message}`);
    }
  });

  pushLog(`🔗 Listener started with ID ${BOT.subId}`);
}

export async function stopCopyTrader() {
  // flip flag first so async paths exit early
  if (!BOT.running && !BOT.subId && !BOT.connection && BOT.inflight.size === 0) {
    return; // already stopped
  }

  BOT.running = false;
  pushLog("🛑 stopCopyTrader() called");

  // Abort all in-flight network requests (quotes/swap builds)
  for (const c of Array.from(BOT.inflight)) {
    try { c.abort(); } catch {}
  }
  BOT.inflight.clear();

  // Unsubscribe logs listener
  if (BOT.subId !== null && BOT.connection) {
    try {
      await BOT.connection.removeOnLogsListener(BOT.subId);
      pushLog(`✅ Listener ${BOT.subId} removed`);
    } catch (e: any) {
      pushLog(`⚠️ Error removing listener ${BOT.subId}: ${e.message}`);
    }
    BOT.subId = null;
  }

  // Drop connection handle (WS closes on GC)
  BOT.connection = null;

  pushLog("🛑 CopyTrader stopped.");
}

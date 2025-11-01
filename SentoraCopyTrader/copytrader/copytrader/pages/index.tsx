import { useState, useEffect } from "react";
import { FaXTwitter } from "react-icons/fa6";   // from FontAwesome v6
import { FaTelegramPlane } from "react-icons/fa"; // from FontAwesome v5

export default function Home() {
  const [logs, setLogs] = useState<string[]>([]);
  const [isRunning, setIsRunning] = useState(false);

  // helper to add logs from UI or SSE
  const addLog = (msg: string) => {
    setLogs((prev) => [...prev, `${new Date().toLocaleTimeString()} — ${msg}`]);
  };

  // connect to SSE stream on mount
  useEffect(() => {
    const eventSource = new EventSource("/api/stream");
    eventSource.onmessage = (e) => {
      addLog(e.data);
    };
    eventSource.onerror = () => {
      addLog("❌ Lost connection to log stream");
      eventSource.close();
    };
    return () => eventSource.close();
  }, []);

  // ⛔ Stop function is here (outside the form)
  async function stopBot() {
    const res = await fetch("/api/copytrade", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "stop" }),
    });

    const data = await res.json();
    if (res.ok) {
      addLog("🛑 " + data.message);
      setIsRunning(false);
    } else {
      addLog("❌ Error stopping: " + (data.error || "Unknown"));
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-black via-[#0a0a1f] to-[#150033] text-white flex flex-col items-center">
      {/* Header */}
<header className="w-full flex justify-between items-center px-8 py-4">
  {/* Left: Logo + Title */}
  <div className="flex items-center space-x-2">
    <img
      src="/SentoraIcon.jpg"
      alt="Sentora Logo"
      className="w-8 h-8"
    />
    <h1 className="text-xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-cyan-400">
      Sentora CopyTrader
    </h1>
  </div>

  {/* Right: Social Icons */}
  <div className="flex items-center space-x-5">
    {/* X (Twitter) */}
    <a
      href="https://x.com/yourprofile"
      target="_blank"
      rel="noopener noreferrer"
      className="relative group"
    >
<svg
  xmlns="http://www.w3.org/2000/svg"
  viewBox="0 0 1200 1227"
  className="w-8 h-8"
>
  <defs>
    <linearGradient id="sentoraGradientX" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stopColor="#06b6d4" /> {/* cyan */}
      <stop offset="100%" stopColor="#a855f7" /> {/* purple */}
    </linearGradient>
  </defs>
  <path
    fill="url(#sentoraGradientX)"
    d="M714.163 519.284L1160.89 0H1054.68L667.137 450.887
       L357.328 0H0L468.406 681.821L0 1226.37H106.215
       L515.446 749.663L842.672 1226.37H1200L714.137 519.284H714.163Z
       M567.605 687.151L521.793 620.936L144.9 79.6941H306.615
       L604.525 506.621L650.337 572.836L1055.15 1150.31H893.432
       L567.605 687.177V687.151Z"
  />
</svg>

    </a>

    {/* Telegram */}
    <a
      href="https://t.me/yourtelegram"
      target="_blank"
      rel="noopener noreferrer"
      className="relative group"
    >
<svg
  xmlns="http://www.w3.org/2000/svg"
  viewBox="0 0 26 26"
  className="w-10 h-10"
  fill="none"
>
  <defs>
    <linearGradient id="sentoraGradientTg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stopColor="#06b6d4" />
      <stop offset="100%" stopColor="#a855f7" />
    </linearGradient>
  </defs>

  <path
    d="M21 3 L2.5 10.5c-.6.2-.6 1.2 0 1.4l5 1.7 2 6.4c.2.6 1 .8 1.5.3l3-3.2 5.2 3.9c.5.4 1.3.1 1.5-.6l3-16.8c.2-.8-.6-1.4-1.4-1.1z"
    stroke="url(#sentoraGradientTg)"
    strokeWidth="1.6"
    strokeLinecap="round"
    strokeLinejoin="round"
    fill="none"
  />
</svg>



    </a>
  </div>
</header>



      {/* Hero */}
      <main className="flex flex-col items-center text-center mt-12 max-w-2xl">
        <h2 className="text-4xl font-bold mb-4 bg-gradient-to-r from-cyan-400 to-purple-500 text-transparent bg-clip-text">
          Solana Copy Trading Bot
        </h2>
        <p className="text-gray-400 mb-10">
          Copy any wallet’s token trades automatically. Enter a target wallet,
          choose your SOL amount, and let the bot mirror their trades in real time.
        </p>

        {/* Card Form */}
        <div className="bg-[#0e0e24] rounded-2xl shadow-xl p-8 w-full border border-purple-900/50">
          <form
            className="flex flex-col space-y-6"
            onSubmit={async (e) => {
              e.preventDefault();
              const targetWallet = (e.currentTarget.elements[0] as HTMLInputElement).value;
              const solAmount = (e.currentTarget.elements[1] as HTMLInputElement).value;
              const copySells = (e.currentTarget.elements.namedItem("copySells") as HTMLInputElement).checked;

              addLog(`🚀 Starting bot for ${targetWallet} with ${solAmount} SOL`);

              const res = await fetch("/api/copytrade", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  action: "start",
                  targetWallet,
                  solAmount,
                  copySells,
                }),
              });

              const data = await res.json();
              if (res.ok) {
                addLog("🟢 " + data.message);
                setIsRunning(true);
              } else {
                addLog("❌ Error: " + (data.error || "Unknown"));
              }
            }}
          >
            <div>
              <label className="block text-sm text-gray-400 mb-2">
                Target Wallet Address
              </label>
              <input
                type="text"
                placeholder="Enter wallet address..."
                className="w-full px-4 py-3 rounded-xl bg-black/40 border border-gray-700 focus:border-purple-500 focus:ring-purple-500 outline-none"
              />
            </div>

            <div>
              <label className="block text-sm text-gray-400 mb-2">
                Amount per Copy (SOL)
              </label>
              <input
                type="number"
                step="any"
                placeholder="0.1"
                className="w-full px-4 py-3 rounded-xl bg-black/40 border border-gray-700 focus:border-purple-500 focus:ring-purple-500 outline-none"
              />
            </div>

            {/* Checkbox */}
{/* Copy Sells Toggle */}
<div className="flex items-center justify-between">
  <span className="text-sm text-gray-400">Copy Sells</span>

  <label htmlFor="copySells" className="relative inline-flex items-center cursor-pointer">
    <input
      type="checkbox"
      id="copySells"
      name="copySells"
      className="sr-only peer"
    />
    <div
      className="w-12 h-6 bg-gray-700 rounded-full peer-checked:bg-gradient-to-r
                 peer-checked:from-cyan-400 peer-checked:to-purple-500 transition-colors duration-300"
    ></div>
    <div
      className="absolute left-1 top-1 w-4 h-4 bg-white rounded-full shadow-md
                 transition-transform duration-300 peer-checked:translate-x-6"
    ></div>
  </label>
</div>

            <button
              type="submit"
              className="w-full py-3 rounded-xl font-semibold bg-gradient-to-r from-cyan-400 to-purple-500 hover:opacity-90 transition"
            >
              Start Copy Trading
            </button>

            <button
              type="button"
              onClick={stopBot}
              disabled={!isRunning}
              className="mt-3 w-full py-3 rounded-xl font-semibold bg-gradient-to-r from-red-500 to-pink-600 hover:opacity-90 transition disabled:opacity-50"
            >
              Stop Copy Trading
            </button>
          </form>
        </div>

        {/* Logs Panel */}
        <div className="mt-8 w-full bg-black/40 border border-purple-800/40 rounded-xl p-4 text-left max-h-64 overflow-y-auto">
          <h3 className="text-lg font-semibold mb-2 text-purple-300">📜 Bot Logs</h3>
          {logs.length === 0 ? (
            <p className="text-gray-500 text-sm">No activity yet.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {logs.map((log, i) => (
                <li key={i} className="text-gray-300">
                  {log}
                </li>
              ))}
            </ul>
          )}
        </div>
      </main>

      {/* Footer */}
      <footer className="mt-16 text-gray-600 text-sm">
        © {new Date().getFullYear()} Sentora Labs. Powered by Solana.
      </footer>
    </div>
  );
}

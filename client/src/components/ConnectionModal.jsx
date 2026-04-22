import { useState } from 'react';

export function ConnectionModal({ currentHost, onConnect, onClose }) {
  const [host, setHost] = useState(currentHost || '');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!host.trim()) return;
    setLoading(true);
    await onConnect(host.trim());
    setLoading(false);
  }

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50">
      <div className="bg-zinc-800 border border-zinc-600 rounded-2xl shadow-2xl p-8 w-full max-w-sm mx-4">
        <h2 className="text-zinc-100 font-bold text-lg mb-1">Connect to SCM820</h2>
        <p className="text-zinc-400 text-sm mb-6">
          Enter the IP address of your Shure SCM820 on the network. TCP port 2202 will be used.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-[10px] text-zinc-500 uppercase tracking-wider mb-2">
              Device IP Address
            </label>
            <input
              type="text"
              value={host}
              onChange={(e) => setHost(e.target.value)}
              placeholder="192.168.1.100"
              autoFocus
              spellCheck={false}
              className="w-full bg-zinc-900 border border-zinc-600 rounded-lg px-4 py-2.5 text-zinc-200 font-mono focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30"
            />
          </div>

          <div className="flex gap-3 pt-1">
            <button
              type="submit"
              disabled={!host.trim() || loading}
              className="flex-1 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold py-2.5 rounded-lg transition-colors text-sm"
            >
              {loading ? 'Connecting…' : 'Connect'}
            </button>
            {onClose && (
              <button
                type="button"
                onClick={onClose}
                className="px-5 bg-zinc-700 hover:bg-zinc-600 text-zinc-300 py-2.5 rounded-lg transition-colors text-sm"
              >
                Cancel
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}

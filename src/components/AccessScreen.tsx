/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { Terminal, Shield, KeyRound, Cpu } from 'lucide-react';

interface AccessScreenProps {
  onAccessGranted: (realName: string, anonymousName: string) => void;
}

export default function AccessScreen({ onAccessGranted }: AccessScreenProps) {
  const [codename, setCodename] = useState('');
  const [passcode, setPasscode] = useState('');
  const [warningMsg, setWarningMsg] = useState<string | null>(null);
  const [bootSequenceLogs, setBootSequenceLogs] = useState<string[]>([]);
  const [isBooting, setIsBooting] = useState(true);

  // Cool mock booting sequences for a authentic hacker terminal vibe
  useEffect(() => {
    const logs = [
      'INITIALIZING ENCRYPTION SHELL v9.1...',
      'ESTABLISHING RSA_4096 COMPLIANT CHANNELS...',
      'CONNECTING TO LOCAL SECURE DATA VAULT...',
      'ISOLATING IP STREAMING LAYERS...',
      'SYSTEM READY. WAITING FOR DAEMON IDENTITY AUTHENTICATION.'
    ];

    let currentIdx = 0;
    const interval = setInterval(() => {
      if (currentIdx < logs.length) {
        setBootSequenceLogs(prev => [...prev, logs[currentIdx]]);
        currentIdx++;
      } else {
        setIsBooting(false);
        clearInterval(interval);
      }
    }, 450);

    return () => clearInterval(interval);
  }, []);

  const handleAccessSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!codename.trim()) {
      setWarningMsg('ERROR: CODENAME PARAMETER SPECIFIED IS VOID.');
      return;
    }

    if (passcode !== '0000') {
      setWarningMsg('CRITICAL ERROR: DECRYPTION PASSCODE REJECTED BY HOST DAEMON.');
      
      // Flash error and self-reset
      setTimeout(() => {
        setPasscode('');
      }, 1000);
      return;
    }

    setWarningMsg(null);

    // Create a truly anonymous suffix to sanitize identity
    const nodeHex = Math.floor(16384 + Math.random() * 49151).toString(16).toUpperCase();
    const anonymousName = `${codename.trim()} [NODE-${nodeHex}]`;

    onAccessGranted(codename.trim(), anonymousName);
  };

  return (
    <div id="access-screen-layer" className="flex flex-col items-center justify-center min-h-screen bg-[#0A0A0A] text-[#E0E0E0] p-4 font-mono select-none">
      <div className="w-full max-w-xl border-4 border-[#1A1A1A] p-6 bg-[#0F0F0F] relative shadow-2xl">
        
        {/* Status flags */}
        <div className="absolute top-0 right-4 translate-y-[-50%] bg-[#0A0A0A] px-2 text-[10px] border border-[#333] flex items-center gap-1.5 font-bold text-white uppercase tracking-wider">
          <div className="w-1.5 h-1.5 bg-white animate-pulse"></div>
          <span>SYS_SECURE</span>
        </div>

        {/* Visual Title Header */}
        <div className="text-center mb-6">
          <p className="text-xs tracking-widest text-[#333] font-bold">
            --------------------------------------------------
          </p>
          <h1 className="text-lg font-bold tracking-widest my-2 text-white">
            SECURE TERMINAL CHAT GATEWAY
          </h1>
          <p className="text-[10px] text-gray-500 tracking-[0.2em] uppercase text-center justify-center">
            RESTRICTED QUANTUM PROTOCOLS // LOCALHOST
          </p>
          <p className="text-xs tracking-widest text-[#333] font-bold">
            --------------------------------------------------
          </p>
        </div>

        {isBooting ? (
          <div className="space-y-2 text-xs min-h-[160px] flex flex-col justify-end py-2 font-mono">
            {bootSequenceLogs.map((log, idx) => (
              <div key={idx} className="flex gap-2 text-gray-300 items-center leading-relaxed">
                <span className="opacity-40">&gt;</span>
                <span className="opacity-80">{log}</span>
              </div>
            ))}
            <div className="flex gap-1 items-center font-bold text-white">
              <span className="opacity-40">&gt;</span>
              <span>SYNCHRONIZING ENVIRONMENT STATS...</span>
              <span className="terminal-cursor"></span>
            </div>
          </div>
        ) : (
          <form onSubmit={handleAccessSubmit} className="space-y-5">
            
            {/* Input 1: Codename */}
            <div className="space-y-1">
              <label htmlFor="codename-input" className="block text-[10px] uppercase tracking-wider text-gray-400 font-bold">
                OPERATOR CODENAME IDENTIFIER:
              </label>
              <div className="relative flex items-center border border-[#444] bg-[#111] p-2.5">
                <span className="text-gray-500 text-xs select-none mr-2">@</span>
                <input
                  id="codename-input"
                  type="text"
                  maxLength={18}
                  value={codename}
                  onChange={(e) => setCodename(e.target.value)}
                  placeholder="ALEX, OR ENIGMA"
                  className="w-full bg-transparent text-white text-xs placeholder-[#333] font-bold focus:outline-none uppercase"
                  autoComplete="off"
                  autoFocus
                />
              </div>
            </div>

            {/* Input 2: Passcode */}
            <div className="space-y-1">
              <label htmlFor="passcode-input" className="block text-[10px] uppercase tracking-wider text-gray-400 font-bold">
                DECRYPTION INTERPASSCODE REQUIRED (0000):
              </label>
              <div className="relative flex items-center border border-[#444] bg-[#111] p-2.5">
                <span className="text-gray-500 text-xs select-none mr-2">$</span>
                <input
                  id="passcode-input"
                  type="password"
                  placeholder="••••"
                  maxLength={6}
                  value={passcode}
                  onChange={(e) => setPasscode(e.target.value)}
                  className="w-full bg-transparent text-white text-xs placeholder-[#333] tracking-[0.4em] font-bold focus:outline-none"
                  autoComplete="off"
                />
              </div>
            </div>

            {/* Warn output if error exists */}
            {warningMsg && (
              <div className="border border-red-900/50 p-2 text-[10px] text-red-400 uppercase text-center font-bold bg-red-950/20">
                [!] {warningMsg}
              </div>
            )}

            {/* System Info */}
            <div className="text-[9px] text-gray-500 border-t border-[#333] pt-4 flex justify-between items-center leading-relaxed">
              <span className="flex items-center gap-1">
                [ Mapped Anonymous Layer Activated ]
              </span>
              <span>PORT: 3000 // PROTOCOL: TLS_1.3</span>
            </div>

            {/* Submit Toggle */}
            <button
              id="submit-access-btn"
              type="submit"
              className="w-full bg-white text-black hover:bg-black hover:text-white border border-white font-bold py-2.5 px-4 transition uppercase tracking-widest text-[10px] cursor-pointer select-none"
            >
              ESTABLISH SECURED CLIENT_NODE
            </button>
          </form>
        )}
      </div>

      {/* Aesthetic bottom text */}
      <p className="mt-6 text-[9px] text-gray-650 tracking-widest text-center select-none uppercase font-bold">
        ENCRYPTED TERMINAL WEB STATION — 100% SECURE COMMUNCATION PROTOCOL
      </p>
    </div>
  );
}

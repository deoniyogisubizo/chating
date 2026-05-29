/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { 
  Terminal, 
  ArrowLeft, 
  Trash2, 
  ShieldAlert, 
  Database, 
  Plus, 
  RefreshCw, 
  Layers, 
  UserMinus, 
  UserX, 
  UserCheck, 
  Hash, 
  Skull 
} from 'lucide-react';
import { ChatRoom } from '../types';

interface AdminConsoleProps {
  onBack: () => void;
  dbMode: 'MongoDB Atlas' | 'Local JSON Vault';
  activeRooms: ChatRoom[];
  totalMessagesCount: number;
}

export default function AdminConsole({ onBack, dbMode, activeRooms, totalMessagesCount }: AdminConsoleProps) {
  const [newRoomName, setNewRoomName] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [adminPasscodeVal, setAdminPasscodeVal] = useState('');
  const [isWiping, setIsWiping] = useState(false);
  const [sysLogLines, setSysLogLines] = useState<string[]>([]);
  
  // Moderated users state
  const [usersData, setUsersData] = useState<{ registered: string[]; active: string[]; blocked: string[] }>({
    registered: [],
    active: [],
    blocked: []
  });

  const fetchUsers = async () => {
    try {
      const response = await fetch('/api/admin/users');
      if (response.ok) {
        const data = await response.json();
        setUsersData(data);
      }
    } catch (err) {
      console.error('Failed to query user indexes:', err);
    }
  };

  useEffect(() => {
    fetchUsers();
    // Refresh list every 4 seconds dynamically on admin screen
    const t = setInterval(fetchUsers, 4000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    setSysLogLines([
      'ADMIN_MONITOR INITIATED: VERIFYING CRYPTO SHIELDS...',
      `DATA PERSISTENCY PROTOCOL: ${dbMode.toUpperCase()}`,
      'SECURE NETWORKING ENGINE: EXPOSED ROUTE LISTENER PORT: 3000',
      'MONOCHROMATIC ADMIN INTERFACE: CONNECTED'
    ]);
  }, [dbMode]);

  const addSysLog = (line: string) => {
    setSysLogLines(prev => [`[${new Date().toLocaleTimeString()}] ${line}`, ...prev.slice(0, 50)]);
  };

  const handleCreateRoom = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setSuccessMessage(null);

    if (!newRoomName.trim()) {
      setErrorMessage('ERROR: CHAMBER CODE IDENTIFIER CANNOT BE BLANK.');
      return;
    }

    try {
      const response = await fetch('/api/rooms', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ name: newRoomName })
      });

      const data = await response.json();
      if (!response.ok) {
        setErrorMessage(`ERROR: ${data.error || 'COULD NOT INITIALIZE ROOM'}`);
        return;
      }

      setSuccessMessage(`SUCCESS: SECURE GROUP CHAMBER ${data.name} SEEDED.`);
      addSysLog(`Group chat created: ${data.name}`);
      setNewRoomName('');
    } catch (err: any) {
      setErrorMessage(`CRITICAL FETCH EXCEPTION: ${err.message}`);
    }
  };

  const handleDeleteRoom = async (roomId: string) => {
    if (roomId === 'general-shell') {
      setErrorMessage('OPERATION DENIED: DEFAULT #SECURE_GENERAL_SHELL CANNOT BE UNMOUNTED.');
      return;
    }

    if (!confirm(`CONFIRMATION REQUIRED: ABSOLUTELY ELIMINATE Sec_Chamber [#${roomId}]? ALL MESSAGES WILL BE DESTROYED.`)) {
      return;
    }

    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      const response = await fetch(`/api/admin/rooms/${roomId}`, {
        method: 'DELETE'
      });

      const data = await response.json();
      if (!response.ok) {
        setErrorMessage(`ROOM ELIMINATION EXCEPTION: ${data.error || 'Server error'}`);
        return;
      }

      setSuccessMessage(`SUCCESS: CHAMBER #${roomId} DISINTEGRATED.`);
      addSysLog(`Chamber dissolved: #${roomId}`);
    } catch (err: any) {
      setErrorMessage(`DELETE CAPABILITY FAILED: ${err.message}`);
    }
  };

  const handleToggleBlock = async (username: string, isBlockedNow: boolean) => {
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      const response = await fetch('/api/admin/users/block', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ username, block: !isBlockedNow })
      });

      const data = await response.json();
      if (!response.ok) {
        setErrorMessage(`MODERATION TRAP: ${data.error || 'Request failure'}`);
        return;
      }

      setSuccessMessage(`SUCCESS: OPERATOR ${username} ${!isBlockedNow ? 'BLOCKED/SUSPENDED' : 'RESTORED'}`);
      addSysLog(`Operator Status update: ${username} -> ${!isBlockedNow ? 'SUSPENDED' : 'UNBLOCKED'}`);
      fetchUsers();
    } catch (err: any) {
      setErrorMessage(`MOD EXCEPTION: ${err.message}`);
    }
  };

  const handleDeleteUser = async (username: string) => {
    if (!confirm(`CRITICAL CONFIRMATION: DEREGISTER AND Expulse operator node [${username}]? This forces custom stream termination.`)) {
      return;
    }

    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      const response = await fetch('/api/admin/users/delete', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ username })
      });

      const data = await response.json();
      if (!response.ok) {
        setErrorMessage(`PURGE EXCEPTION: ${data.error || 'Request failure'}`);
        return;
      }

      setSuccessMessage(`SUCCESS: Operator ${username} completely deleted.`);
      addSysLog(`Operator deleted from registry: ${username}`);
      fetchUsers();
    } catch (err: any) {
      setErrorMessage(`PURGE FAILURE: ${err.message}`);
    }
  };

  const handleWipeDatabase = async () => {
    setErrorMessage(null);
    setSuccessMessage(null);

    if (adminPasscodeVal !== '0000') {
      setErrorMessage('OPERATION DENIED: ADMIN PASSCODE DOES NOT MATCH (0000 CODE REQ)');
      addSysLog('UNAUTHORIZED ENERGETIC ERASE REQUESTED. GATEWAYS SEALED.');
      return;
    }

    if (!confirm('CRITICAL ACTION: POSITIVELY RESET CORES AND START NEW SECURE SESSION? EVERY LOG WILL DISSOLVE.')) {
      return;
    }

    setIsWiping(true);
    addSysLog('Wiping database structure and re-seeding bootstrap General room.');

    try {
      const response = await fetch('/api/admin/reset', {
        method: 'POST'
      });

      const data = await response.json();
      if (!response.ok) {
        setErrorMessage(`WIPEOUT EXCEPTION: ${data.error || 'Server error'}`);
        setIsWiping(false);
        return;
      }

      setSuccessMessage('DEVASTATION COMPLETED: Chat database cleared. Refreshing core layout...');
      addSysLog('Global nuclear restart completed.');
      setAdminPasscodeVal('');
      
      setTimeout(() => {
        window.location.reload();
      }, 1500);

    } catch (err: any) {
      setErrorMessage(`WIPEOUT FETCH FAILED: ${err.message}`);
    } finally {
      setIsWiping(false);
    }
  };

  return (
    <div id="admin-console-layout" className="flex flex-col h-screen bg-[#0A0A0A] text-[#E0E0E0] p-4 sm:p-6 font-mono select-none overflow-y-auto space-y-4 text-xs">
      
      {/* Immersive Header Panel */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center border border-[#333] p-4 bg-[#0F0F0F] gap-4 shrink-0">
        <div className="flex items-center gap-3">
          <ShieldAlert className="w-6 h-6 text-white shrink-0 animate-pulse" />
          <div>
            <h1 className="text-sm font-bold tracking-widest text-[#ffffff]">ROOT_CONSOLE@SECURE_TERMINAL_V4:~#</h1>
            <p className="text-[10px] text-gray-400 uppercase font-bold">CONTROL VAULT CENTER // ENCRYPTION ENFORCED</p>
          </div>
        </div>
        
        <button
          onClick={onBack}
          className="w-full sm:w-auto flex items-center justify-center gap-2 bg-white text-black border border-white px-4 py-2 text-xs hover:bg-black hover:text-white transition font-bold select-none cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>EXIT_TO_CHAT</span>
        </button>
      </div>

      {/* Main Grid Section */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 pb-4">
        
        {/* Left Section: Roster and Users (col-span-7) */}
        <div className="lg:col-span-7 space-y-4">
          
          {/* Module 1: Operator Node Moderation (Block/Delete/Sync-nodes) */}
          <div className="border border-[#333] p-4 bg-[#080808] space-y-4">
            <h2 className="text-xs uppercase tracking-wider border-b border-[#333] pb-2 flex items-center gap-2 font-bold text-white">
              <Terminal className="w-4 h-4 text-white" />
              OPERATOR NODE REGISTRY MODULE (MANAGEMENT)
            </h2>

            <div className="space-y-4">
              {/* Connected / Registered dynamic nodes table */}
              <div className="border border-[#222] bg-[#020202] text-[11px]">
                <div className="grid grid-cols-12 bg-[#111] p-2 border-b border-[#333] font-bold text-gray-400 uppercase text-[9px] tracking-wide">
                  <div className="col-span-5 sm:col-span-6">OPERATOR ADDRESS / CODENAME</div>
                  <div className="col-span-3 sm:col-span-2">STATUS</div>
                  <div className="col-span-4 sm:col-span-4 text-right">ADMIN_PORT_UTILITY</div>
                </div>

                <div className="divide-y divide-[#222] max-h-[290px] overflow-y-auto">
                  {usersData.registered.length === 0 ? (
                    <div className="p-4 text-center text-gray-600 font-bold uppercase text-[9px]">
                      [ NO REGISTERED CHAT NODES INDEXED IN SYSTEM ]
                    </div>
                  ) : (
                    usersData.registered.map((user) => {
                      const isActive = usersData.active.includes(user);
                      const isBlocked = usersData.blocked.includes(user);

                      return (
                        <div key={user} className="grid grid-cols-12 p-2.5 items-center hover:bg-[#0c0c0c] transition">
                          {/* Title */}
                          <div className="col-span-5 sm:col-span-6 flex items-center gap-1.5 truncate pr-1">
                            <span className="w-1.5 h-1.5 bg-[#444] border border-[#666]"></span>
                            <span className="font-bold text-gray-200 select-all truncate">{user}</span>
                          </div>

                          {/* Status */}
                          <div className="col-span-3 sm:col-span-2">
                            {isBlocked ? (
                              <span className="bg-red-950/40 text-red-500 border border-red-900 px-1 py-0.5 text-[8px] font-bold uppercase">
                                BLOCKED
                              </span>
                            ) : isActive ? (
                              <span className="bg-white text-black px-1.5 py-0.5 text-[8px] font-bold uppercase animate-pulse">
                                ONLINE
                              </span>
                            ) : (
                              <span className="text-gray-500 text-[8px] font-bold uppercase border border-[#222] px-1 py-0.5">
                                OFFLINE
                              </span>
                            )}
                          </div>

                          {/* Controls */}
                          <div className="col-span-4 sm:col-span-4 flex items-center justify-end gap-1 px-1">
                            {/* Block Toggle */}
                            <button
                              onClick={() => handleToggleBlock(user, isBlocked)}
                              className={`p-1.5 border hover:bg-white hover:text-black transition cursor-pointer text-[10px] uppercase font-bold shrink-0 ${
                                isBlocked 
                                  ? 'border-emerald-800 text-emerald-400 hover:border-white' 
                                  : 'border-[#444] text-[#aaa] hover:border-white'
                              }`}
                              title={isBlocked ? "Unblock Operator Node" : "Suspend Operator Node"}
                            >
                              {isBlocked ? <UserCheck className="w-3.5 h-3.5" /> : <UserX className="w-3.5 h-3.5" />}
                            </button>

                            {/* Purge delete node */}
                            <button
                              onClick={() => handleDeleteUser(user)}
                              className="p-1.5 border border-[#444] text-[#aa4444] hover:border-red-500 hover:bg-red-950 hover:text-white transition cursor-pointer font-bold shrink-0"
                              title="Deregister node completamente"
                            >
                              <UserMinus className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              <p className="text-[10px] text-gray-500 italic">
                * Note: Deregistering operators forces their stream socket connection to discard permanently. Blocking locks all inputs and transmission capabilities immediately.
              </p>
            </div>
          </div>
          
        </div>

        {/* Right Section: Rooms and Database (col-span-5) */}
        <div className="lg:col-span-5 space-y-4">
          
          {/* Module 2: Secure Groups Creation / Seeding */}
          <div className="border border-[#333] p-4 bg-[#080808] space-y-4">
            <h2 className="text-xs uppercase tracking-wider border-b border-[#333] pb-2 flex items-center gap-2 font-bold text-white">
              <Plus className="w-4 h-4 text-white" />
              CREATE SECURE GROUP CHAT
            </h2>

            <form onSubmit={handleCreateRoom} className="space-y-4">
              <div className="space-y-1">
                <label htmlFor="chamber-id-input" className="block text-[10px] text-gray-400 uppercase font-bold">GROUP CHAMBER LABEL (A-Z, 0-9):</label>
                <input
                  id="chamber-id-input"
                  type="text"
                  placeholder="e.g. BACKEND_NETWORKS, RED_SECTOR"
                  value={newRoomName}
                  onChange={(e) => setNewRoomName(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '_'))}
                  className="w-full bg-[#111] text-white text-xs border border-[#444] p-2.5 focus:border-white focus:outline-none uppercase font-bold"
                />
              </div>

              <button
                id="create-chamber-btn"
                type="submit"
                className="w-full bg-white text-black hover:bg-black hover:text-white border border-white font-bold py-2.5 px-3 text-xs uppercase cursor-pointer select-none transition"
              >
                SPAWN SECURE CHAMELEON GROUP
              </button>
            </form>
          </div>

          {/* Module 3: Active Groups / Channels destruction */}
          <div className="border border-[#333] p-4 bg-[#080808] space-y-3">
            <h2 className="text-xs uppercase tracking-wider border-b border-[#333] pb-2 flex items-center gap-2 font-bold text-white">
              <Hash className="w-4 h-4 text-white" />
              MANAGE SECURE CHAMBER INDEX ({activeRooms.length})
            </h2>

            <div className="border border-[#222] bg-[#020202] text-[11px] divide-y divide-[#222] max-h-[160px] overflow-y-auto">
              {activeRooms.map((room) => {
                const isGeneral = room.id === 'general-shell';
                return (
                  <div key={room.id} className="flex items-center justify-between p-2 hover:bg-[#0c0c0c] transition">
                    <span className="font-bold text-gray-300 truncate pr-2"># {room.name}</span>
                    <button
                      onClick={() => handleDeleteRoom(room.id)}
                      disabled={isGeneral}
                      className={`px-2 py-1 text-[9px] border font-bold transition uppercase ${
                        isGeneral 
                          ? 'border-[#222] text-gray-700 pointer-events-none' 
                          : 'border-red-900 text-red-500 hover:bg-red-950 hover:text-white hover:border-red-500 cursor-pointer'
                      }`}
                      title={isGeneral ? "System default static core channel" : "Dissolve group chat chamber"}
                    >
                      DISSOLVE
                    </button>
                  </div>
                );
              })}
            </div>
          </div>

        </div>

      </div>

      {/* Database Diagnostic and Core Wipe controls */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        
        {/* Diagnostic Logs Column */}
        <div className="border border-[#333] p-4 bg-[#080808] space-y-3">
          <h2 className="text-xs uppercase tracking-wider border-b border-[#333] pb-2 flex items-center gap-2 font-bold text-white">
            <Database className="w-4 h-4 text-white" />
            PARTITION TELEMETRY STATUS
          </h2>

          <div className="grid grid-cols-2 gap-2 text-[11px] font-mono">
            <div className="border border-[#222] p-2 bg-[#050505]">
              <span className="block text-gray-500 text-[9px] font-bold uppercase">DATABASE PORTAL</span>
              <span className="font-bold text-white">{dbMode}</span>
            </div>
            <div className="border border-[#222] p-2 bg-[#050505]">
              <span className="block text-gray-500 text-[9px] font-bold uppercase">MESSAGES STORED</span>
              <span className="font-bold text-white">{totalMessagesCount} PACKETS</span>
            </div>
          </div>

          <div className="border border-[#333] p-3 bg-[#030303] leading-relaxed max-h-[110px] overflow-y-auto text-gray-400 font-mono text-[10px]">
            {sysLogLines.map((log, lIdx) => (
              <div key={lIdx} className="truncate select-none">&gt; {log}</div>
            ))}
          </div>
        </div>

        {/* Global Reset Column */}
        <div className="border border-[#333] p-4 bg-[#080808] space-y-3">
          <h2 className="text-xs uppercase tracking-wider border-b border-[#333] pb-2 flex items-center gap-2 text-white font-bold">
            <Skull className="w-4 h-4 text-white" />
            SYSTEM WIPE / RESET CONSOLE
          </h2>

          <p className="text-[10px] text-gray-500 leading-relaxed font-mono uppercase">
            [!] WARNING: EXECUTION ERASES ALL MESSAGES, CHANNELS, OPERATORS, AND BLOCKS GLOBALLY. ALL ACTIVE TERMINALS REBOOT FORCEFULLY.
          </p>

          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
            <div className="flex-1 space-y-1">
              <input
                id="input-wipe-code"
                type="password"
                placeholder="PASSCODE: 0000"
                maxLength={4}
                value={adminPasscodeVal}
                onChange={(e) => setAdminPasscodeVal(e.target.value)}
                className="w-full bg-[#111] text-white text-center text-xs border border-[#444] p-2.5 focus:border-white focus:outline-none font-bold"
              />
            </div>

            <button
              id="wipe-db-init-btn"
              onClick={handleWipeDatabase}
              disabled={isWiping}
              className="flex-shrink-0 bg-white text-black hover:bg-black hover:text-white border border-white font-bold px-4 py-2.5 text-xs uppercase transition cursor-pointer select-none"
            >
              {isWiping ? 'WIPING...' : 'DESTRUCT ALL'}
            </button>
          </div>
        </div>

      </div>

      {/* Global Notifications Feed / Feedback */}
      {(errorMessage || successMessage) && (
        <div className="shrink-0 p-1">
          {errorMessage && (
            <div className="border border-red-900 bg-red-950/20 p-2.5 text-[10px] text-red-500 uppercase tracking-widest text-center font-bold animate-pulse">
              [!] CRITICAL_ERROR: {errorMessage}
            </div>
          )}
          {successMessage && (
            <div className="border border-emerald-900 bg-emerald-950/20 p-2.5 text-[10px] text-emerald-400 uppercase tracking-widest text-center font-bold">
              [*] EVENT_REPORT: {successMessage}
            </div>
          )}
        </div>
      )}

      {/* Footer System Status details */}
      <div className="mt-auto pt-4 text-[9px] text-gray-500 flex justify-between uppercase font-bold border-t border-[#222]">
        <span>LEVEL_7 OPER_CONSOLE</span>
        <span>VAULT_INTERFACE_SECURED</span>
      </div>
    </div>
  );
}

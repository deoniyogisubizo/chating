/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { 
  Terminal, 
  Send, 
  Mic, 
  Square, 
  Paperclip, 
  FolderUp, 
  Lock, 
  Cpu, 
  Plus, 
  Wifi, 
  Folder, 
  FileText, 
  Download, 
  User, 
  SlidersHorizontal 
} from 'lucide-react';
import { ChatMessage, ChatRoom } from '../types';

interface TerminalConsoleProps {
  realName: string;
  anonymousName: string;
  rooms: ChatRoom[];
  messages: ChatMessage[];
  activeRoomId: string;
  typingUsers: string[];
  dbMode: string;
  onSelectRoom: (roomId: string) => void;
  onSendMessage: (text: string) => void;
  onSendFile: (fileName: string, fileSize: number, base64: string) => void;
  onSendFolder: (folderName: string, totalSize: number, files: any[]) => void;
  onSendVoice: (base64Audio: string) => void;
  onTypingEvent: (isTyping: boolean) => void;
  onLoadAdmin: () => void;
  isBlocked: boolean;
}

export default function TerminalConsole({
  realName,
  anonymousName,
  rooms,
  messages,
  activeRoomId,
  typingUsers,
  dbMode,
  onSelectRoom,
  onSendMessage,
  onSendFile,
  onSendFolder,
  onSendVoice,
  onTypingEvent,
  onLoadAdmin,
  isBlocked
}: TerminalConsoleProps) {
  const [inputText, setInputText] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const [recDuration, setRecDuration] = useState(0);
  const [expandedFolders, setExpandedFolders] = useState<Record<string, boolean>>({});
  const [showAddRoomModal, setShowAddRoomModal] = useState(false);
  const [newRoomChamberName, setNewRoomChamberName] = useState('');
  
  // Audio state
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioStreamRef = useRef<MediaStream | null>(null);
  const audioIntervalRef = useRef<any>(null);

  // Scroll ref
  const logStreamEndRef = useRef<HTMLDivElement | null>(null);

  // Auto-scroll when messages update
  useEffect(() => {
    logStreamEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Handle Typing Timer
  const typingTimeoutRef = useRef<any>(null);
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInputText(e.target.value);
    onTypingEvent(true);

    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => {
      onTypingEvent(false);
    }, 1500);
  };

  const handleMessageFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim()) return;

    onSendMessage(inputText);
    setInputText('');
    onTypingEvent(false);
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
  };

  // Convert File helper
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      const base64 = reader.result as string;
      onSendFile(file.name, file.size, base64);
    };
    reader.readAsDataURL(file);
    
    // Clear selection
    e.target.value = '';
  };

  // Convert Folder structure helper
  const handleFolderChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const filesList = e.target.files;
    if (!filesList || filesList.length === 0) return;

    const uploadedItems: any[] = [];
    let cumulativeSize = 0;
    const folderLabel = (filesList[0] as any).webkitRelativePath?.split('/')?.[0] || 'INDEXED_FOLDER';

    for (let i = 0; i < filesList.length; i++) {
      const file = filesList[i];
      cumulativeSize += file.size;
      const pathValue = (file as any).webkitRelativePath || file.name;
      
      const base64 = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.readAsDataURL(file);
      });

      uploadedItems.push({
        name: file.name,
        size: file.size,
        path: pathValue,
        base64
      });
    }

    onSendFolder(folderLabel, cumulativeSize, uploadedItems);
    
    // Clear selection
    e.target.value = '';
  };

  // Voice Recording Engine
  const handleStartVoiceRecord = async () => {
    try {
      setRecDuration(0);
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioStreamRef.current = stream;

      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      const audioChunks: Blob[] = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunks.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
        const reader = new FileReader();
        reader.onloadend = () => {
          const rawBase64 = reader.result as string;
          onSendVoice(rawBase64);
        };
        reader.readAsDataURL(audioBlob);

        // Terminate mic threads
        stream.getTracks().forEach(track => track.stop());
      };

      mediaRecorder.start();
      setIsRecording(true);

      audioIntervalRef.current = setInterval(() => {
        setRecDuration(prev => prev + 1);
      }, 1000);

    } catch (err) {
      console.error(err);
      alert("[X] PERMISSION DENIED: AUDIO RECORDING BLOCKED BY PARENT DEVICE ACCESS CONFIG.");
    }
  };

  const handleStopVoiceRecord = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      clearInterval(audioIntervalRef.current);
    }
  };

  const downloadBase64Resource = (fileName: string, base64: string) => {
    const dLink = document.createElement('a');
    dLink.href = base64;
    dLink.download = fileName;
    dLink.click();
  };

  const toggleFolderExpansion = (msgId: string) => {
    setExpandedFolders(prev => ({
      ...prev,
      [msgId]: !prev[msgId]
    }));
  };

  const handleCreateChamberFast = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newRoomChamberName.trim()) return;

    try {
      const response = await fetch('/api/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newRoomChamberName })
      });

      if (response.ok) {
        setNewRoomChamberName('');
        setShowAddRoomModal(false);
        // Rooms sync will fetch automatically or via Socket broadcast
      } else {
        const err = await response.json();
        alert(`[!] ROOM CREATION FAILURE: ${err.error}`);
      }
    } catch (err: any) {
      alert(`[!] EXCEPTION: ${err.message}`);
    }
  };

  return (
    <div id="terminal-interface-wrapper" className="flex flex-col h-screen bg-[#0A0A0A] text-[#E0E0E0] font-mono selection:bg-white selection:text-black select-none overflow-hidden text-xs">
      
      {/* Immersive Header Panel */}
      <header className="h-12 border-b border-[#333] flex items-center justify-between px-6 bg-[#0F0F0F] shrink-0">
        <div className="flex items-center gap-4">
          <div className="w-2 h-2 bg-white animate-pulse"></div>
          <span className="text-xs tracking-widest uppercase font-bold text-white">System: Secure_Terminal_v4.0.2</span>
        </div>
        <div className="text-[10px] opacity-40 uppercase tracking-[0.2em] hidden md:block">
          Connection: Established // Sync_Protocol: 3sec
        </div>
        <div className="text-[10px] text-gray-500 font-mono tracking-wider">
          NODE: SECURE // ENV: ACTIVE
        </div>
      </header>

      {/* Main Terminal View Container */}
      <div className="flex-1 flex overflow-hidden">
        
        {/* Sidebar Panel: Rooms / Channels list */}
        <aside className="w-64 border-r border-[#333] flex flex-col bg-[#080808] shrink-0">
          <div className="p-4 border-b border-[#333] flex justify-between items-center bg-[#090909]">
            <div>
              <div className="text-[10px] opacity-50 mb-0.5">ACTIVE_ROOM</div>
              <div className="text-xs font-bold text-white tracking-tight truncate max-w-[140px]">
                # {rooms.find(r => r.id === activeRoomId)?.name || 'NONE_SELECTED'}
              </div>
            </div>
          </div>

          {/* Rooms interactive list */}
          <div className="flex-1 p-4 overflow-y-auto space-y-4">
            <div>
              <div className="text-[10px] opacity-50 mb-3 uppercase tracking-wider font-bold">Authenticated_Chambers</div>
              <ul className="space-y-2">
                {rooms.map((room) => {
                  const active = room.id === activeRoomId;
                  return (
                    <li key={room.id}>
                      <button
                        onClick={() => onSelectRoom(room.id)}
                        className={`w-full text-left text-xs py-2 px-2.5 transition flex items-center justify-between border cursor-pointer ${
                          active
                            ? 'bg-white text-black border-white font-bold'
                            : 'bg-transparent border-[#222] hover:bg-[#111] hover:border-[#444] text-[#B0B0B0]'
                        }`}
                      >
                        <span className="truncate"># {room.name.replace('SECURE_', '')}</span>
                        {active && <span className="text-[8px] font-mono">[LIVE]</span>}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>

            {/* Simulated online roster to fill terminal aesthetics with original data */}
            <div className="pt-2">
              <div className="text-[10px] opacity-30 mb-2 uppercase tracking-wider">ACTIVE_NET_NODES</div>
              <div className="space-y-2 text-[11px] text-gray-500 font-medium font-mono">
                <div className="flex items-center gap-2">
                  <span className="w-1.5 h-1.5 border border-[#333]"></span>
                  <span className="truncate text-gray-400">{anonymousName} (YOU)</span>
                </div>
                {typingUsers.map((user, uidx) => (
                  <div key={uidx} className="flex items-center gap-2 italic animate-pulse text-white">
                    <span className="w-1.5 h-1.5 bg-white"></span>
                    <span className="truncate">{user} (typing)</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="p-4 border-t border-[#333] bg-[#050505]">
            <div className="text-[9px] opacity-40 leading-relaxed font-mono">
              ACCESS_CODE: 0000<br />
              ENCRYPTION: AES-256<br />
              DB_STATUS: {dbMode.toUpperCase()}<br />
              SYS_OPER_KEY: {anonymousName.split(' ')[1] || 'VOID'}
            </div>
          </div>
        </aside>

        {/* Chat Stream Section */}
        <section className="flex-1 flex flex-col relative bg-[#0A0A0A] overflow-hidden">
          
          {/* Messages Listing Feed */}
          <div className="flex-1 p-6 space-y-4 overflow-y-auto">
            {messages.map((msg) => {
              const isSystem = msg.sender === 'SYSTEM_DAEMON';
              const timestampFormatted = new Date(msg.timestamp).toLocaleTimeString();

              if (isSystem) {
                return (
                  <div key={msg.id} className="flex gap-4 items-start border-l border-white/20 pl-3 py-1 opacity-70">
                    <span className="text-[10px] opacity-35 mt-0.5">[{timestampFormatted}]</span>
                    <div className="flex-1 text-[11px]">
                      <span className="font-bold uppercase tracking-wider text-white">SYSTEM_DAEMON:</span>
                      <p className="mt-1 leading-relaxed text-gray-300 italic">&gt; {msg.text}</p>
                    </div>
                  </div>
                );
              }

              return (
                <div key={msg.id} className="flex gap-4 items-start hover:bg-white/[0.02] p-1 transition rounded-xs">
                  <span className="text-[10px] opacity-30 mt-1 select-none">[{timestampFormatted}]</span>
                  <div className="flex-1">
                    <span className="text-xs font-bold text-white">{msg.sender}:</span>
                    
                    {/* Render content depending on message subtype */}
                    <div className="mt-1">
                      
                      {/* Subtype 1: Standard Text */}
                      {msg.type === 'text' && (
                        <p className="text-xs leading-relaxed text-[#D0D0D0] whitespace-pre-wrap">{msg.text}</p>
                      )}

                      {/* Subtype 2: Encrypted file container styling matching Immersive UI */}
                      {msg.type === 'file' && (
                        <div className="mt-1 p-2 border border-[#333] inline-flex flex-col sm:flex-row sm:items-center gap-3 bg-[#111] max-w-sm">
                          <div className="flex items-center gap-2">
                            <div className="w-5 h-5 border border-white flex items-center justify-center text-[8px] font-bold shrink-0">F</div>
                            <div className="text-[10px] truncate max-w-[150px] sm:max-w-[200px]">
                              <p className="font-bold truncate text-white">{msg.fileName}</p>
                              <p className="opacity-40 text-[9px] uppercase mt-0.5">{((msg.fileSize || 0) / 1024).toFixed(1)} KB</p>
                            </div>
                          </div>
                          {msg.payload && (
                            <button
                              onClick={() => downloadBase64Resource(msg.fileName || 'binary_packet', msg.payload!)}
                              className="text-[9px] hover:underline bg-white text-black px-2 py-1 font-bold shrink-0 cursor-pointer uppercase select-none text-center"
                            >
                              [ PULL_FILE ]
                            </button>
                          )}
                        </div>
                      )}

                      {/* Subtype 3: Custom voice wave representation */}
                      {msg.type === 'voice' && (
                        <div className="mt-1 flex flex-col gap-2 p-2.5 border border-[#333] bg-[#111] max-w-xs">
                          <div className="flex items-center gap-2">
                            <div className="h-4 w-32 bg-gradient-to-r from-white via-transparent to-transparent opacity-20"></div>
                            <span className="text-[10px] opacity-50 italic">[ SEC_VOICE_NOTE ]</span>
                          </div>
                          {msg.payload && (
                            <audio
                              src={msg.payload}
                              controls
                              className="w-full h-7 border border-[#333] invert brightness-100 rounded-none bg-black grayscale filter scale-[0.98] outline-none"
                            />
                          )}
                        </div>
                      )}

                      {/* Subtype 4: Interactive Directory Workspace */}
                      {msg.type === 'folder' && (
                        <div className="mt-1 border border-[#333] bg-[#111] p-3 max-w-md w-full">
                          <div className="flex justify-between items-center border-b border-[#333] pb-2 mb-2">
                            <div className="flex items-center gap-2">
                              <Folder className="w-4 h-4 text-white shrink-0" />
                              <div className="text-[10px]">
                                <p className="font-bold text-white capitalize">{msg.fileName}/</p>
                                <p className="opacity-40 text-[9px]">WORKSPACE DIRECTORY / {((msg.fileSize || 0) / 1024).toFixed(1)} KB</p>
                              </div>
                            </div>
                            <button
                              onClick={() => toggleFolderExpansion(msg.id)}
                              className="border border-[#444] px-1.5 py-0.5 hover:bg-white hover:text-black transition text-[8px] uppercase font-bold cursor-pointer select-none"
                            >
                              {expandedFolders[msg.id] ? '[ SYSTEM_CLOSE ]' : '[ WORKSPACE_EXPLORE ]'}
                            </button>
                          </div>

                          {expandedFolders[msg.id] && msg.payload && (() => {
                            try {
                              const nodes = JSON.parse(msg.payload);
                              return (
                                <div className="space-y-1.5 mt-2 max-h-[180px] overflow-y-auto text-[10px] border-l border-[#333] pl-2 font-mono">
                                  {nodes.map((node: any, nIdx: number) => (
                                    <div key={nIdx} className="flex justify-between items-center py-1 opacity-80 hover:opacity-100">
                                      <span className="truncate pr-4 text-gray-300 select-all" title={node.path}>&gt; {node.path}</span>
                                      <button
                                        onClick={() => downloadBase64Resource(node.name, node.base64)}
                                        className="hover:underline text-[8px] font-bold text-white uppercase cursor-pointer select-none"
                                      >
                                        [PULL]
                                      </button>
                                    </div>
                                  ))}
                                </div>
                              );
                            } catch {
                              return <p className="text-red-500 text-[8px]">CORRUPT STRUCT PACKET</p>;
                            }
                          })()}
                        </div>
                      )}

                    </div>
                  </div>
                </div>
              );
            })}
            <div ref={logStreamEndRef} />
          </div>

          {/* Interactive Input Footer */}
          <div className="p-6 border-t border-[#333] bg-[#0A0A0A] shrink-0">
            
            {/* Elegant Typing Notifier matching design specs */}
            <div className="h-4 mb-2 flex items-center">
              {typingUsers.length > 0 ? (
                <span className="text-[10px] opacity-60 animate-pulse uppercase tracking-wider text-white">
                  [!] {typingUsers.join(', ')} {typingUsers.length === 1 ? 'is' : 'are'} streaming packet payloads...
                </span>
              ) : (
                <span className="text-[9px] opacity-20 uppercase tracking-widest text-[#555]">
                  {isBlocked ? "CONNECTION SUSPENDED // MOUNT RE-ONLY" : "Secure input node active // ready for instruction"}
                </span>
              )}
            </div>

            {/* Suspended user banner */}
            {isBlocked && (
              <div className="mb-3 border border-red-900 bg-red-950/20 text-red-500 p-2.5 font-bold text-[10px] tracking-wider uppercase text-center animate-pulse">
                [!] CRITICAL: OPERATOR ACCESS RIGHTS DISBALED BY ADMIN. OUTBOUND STREAMS Muted.
              </div>
            )}

            {/* Monochromatic Input Container with integrated triggers */}
            <form onSubmit={handleMessageFormSubmit} className="relative flex items-center border border-[#444] bg-[#111] p-2 sm:p-3 gap-3">
              <span className="text-white text-xs select-none">$</span>
              
              <input
                type="text"
                value={inputText}
                onChange={handleInputChange}
                disabled={isRecording || isBlocked}
                placeholder={
                  isBlocked 
                    ? "COMMUNICATIONS RECONSTRUCT Muted. ENTRANCE FORBIDDEN." 
                    : isRecording 
                    ? "TRANSMITTING VOICE WAVELENGTH ENVELOPE..." 
                    : "Enter transmission payload or instruction..."
                }
                className="bg-transparent border-none outline-none flex-1 text-xs sm:text-sm text-white placeholder-[#2A2A2A] font-bold disabled:opacity-40"
                autoComplete="off"
              />

              <div className="flex items-center gap-1 sm:gap-2 px-2 border-l border-[#333] shrink-0">
                {/* Voice toggle trigger */}
                <button
                  type="button"
                  onClick={isRecording ? handleStopVoiceRecord : handleStartVoiceRecord}
                  disabled={isBlocked}
                  className={`p-2 border transition duration-150 flex items-center justify-center shrink-0 disabled:opacity-20 cursor-pointer ${
                    isRecording 
                      ? 'border-white bg-white text-black animate-pulse' 
                      : 'border-transparent text-gray-400 hover:text-white hover:border-[#444] hover:bg-[#1a1a1a]'
                  }`}
                  title={isRecording ? `Stop Recording (${recDuration}s)` : "Transmit VoiceNote"}
                >
                  {isRecording ? <Square className="w-3.5 h-3.5" /> : <Mic className="w-3.5 h-3.5" />}
                  {isRecording && <span className="ml-1 text-[8px] font-bold">{recDuration}s</span>}
                </button>

                {/* File Attachment toggle triggers */}
                <label 
                  className={`p-2 border border-transparent hover:border-[#444] text-gray-400 hover:text-white hover:bg-[#1a1a1a] transition duration-150 flex items-center justify-center cursor-pointer shrink-0 ${
                    isBlocked ? 'pointer-events-none opacity-20' : ''
                  }`}
                  title="Upload Binary File"
                >
                  <Paperclip className="w-3.5 h-3.5" />
                  <input type="file" onChange={handleFileChange} disabled={isBlocked} className="hidden" />
                </label>

                <label 
                  className={`p-2 border border-transparent hover:border-[#444] text-gray-400 hover:text-white hover:bg-[#1a1a1a] transition duration-150 flex items-center justify-center cursor-pointer shrink-0 ${
                    isBlocked ? 'pointer-events-none opacity-20' : ''
                  }`}
                  title="Upload Directory Workspace"
                >
                  <FolderUp className="w-3.5 h-3.5" />
                  <input
                    type="file"
                    multiple
                    {...({ webkitdirectory: "", directory: "" } as any)}
                    onChange={handleFolderChange}
                    disabled={isBlocked}
                    className="hidden"
                  />
                </label>

                {/* Submit trigger */}
                <button
                  type="submit"
                  disabled={isRecording || !inputText.trim() || isBlocked}
                  className="p-2 border border-transparent hover:border-[#444] text-gray-400 hover:text-white hover:bg-[#1a1a1a] transition duration-150 flex items-center justify-center disabled:opacity-20 disabled:hover:bg-transparent disabled:hover:border-transparent shrink-0 cursor-pointer"
                  title="Send Transmission"
                >
                  <Send className="w-3.5 h-3.5" />
                </button>
              </div>
            </form>
          </div>

        </section>

      </div>

      {/* Immersive Status strip at very bottom of screen */}
      <footer className="h-6 bg-white text-black flex items-center justify-between px-4 text-[9px] font-bold uppercase tracking-widest shrink-0 select-none">
        <div>NODE_STATUS: {isBlocked ? "SUSPENDED" : "ACTIVE"}</div>
        <div className="hidden sm:block">SYSTEM_CHANNEL: STATIC_TLS_PROT</div>
        <div>SYNC_INTERVAL: 3000ms</div>
        <div>ENCRYPT_LAYER: ON</div>
      </footer>

    </div>
  );
}

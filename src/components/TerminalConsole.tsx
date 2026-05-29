import React, { useState, useEffect, useRef } from 'react';
import { Send, Mic, Square, Paperclip, FolderUp, Folder, File, Download, X } from 'lucide-react';
import JSZip from 'jszip';
import { ChatMessage, ChatRoom } from '../types';

const EMOJIS = ['😀','😁','😂','🤣','😃','😄','😅','😆','😉','😊','😋','😎','😍','🥰','😘','🤗','🤩','👍','👎','👊','✊','🤛','🤜','👏','🙌','❤️','💔','🔥','💯','🎉','🎊','💀','☠️','✅','❌','❓','❗','💡','📌','🔒','🔓','⭐','🌟','💪','🖕','🤝','🙏','🚀','💀'];

interface TerminalConsoleProps {
  realName: string;
  anonymousName: string;
  rooms: ChatRoom[];
  messages: ChatMessage[];
  activeRoomId: string;
  typingUsers: string[];
  dbMode: string;
  selectedNode: string | null;
  activeUsers: Array<{ username: string; connectedAt: number }>;
  onSelectRoom: (roomId: string) => void;
  onSelectNode: (username: string) => void;
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
  selectedNode,
  activeUsers,
  onSelectRoom,
  onSelectNode,
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
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [expandedFolders, setExpandedFolders] = useState<Record<string, boolean>>({});
  const [nodeInfoPopup, setNodeInfoPopup] = useState<{ username: string; connectedAt: number } | null>(null);
  const [nodeInfoData, setNodeInfoData] = useState<{ codename: string; passcode: string; username: string; created: number } | null>(null);
  const logStreamEndRef = useRef<HTMLDivElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioStreamRef = useRef<MediaStream | null>(null);
  const audioIntervalRef = useRef<any>(null);
  const emojiPickerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    logStreamEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (emojiPickerRef.current && !emojiPickerRef.current.contains(e.target as Node)) {
        setShowEmojiPicker(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInputText(e.target.value);
  };

  const handleMessageFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim()) return;
    onSendMessage(inputText);
    setInputText('');
  };

  const handleEmojiClick = (emoji: string) => {
    setInputText(prev => prev + emoji);
    setShowEmojiPicker(false);
  };

  const handleCopyToInput = (text: string) => {
    setInputText(text);
  };

  const handleNodeClick = async (user: { username: string; connectedAt: number }) => {
    setNodeInfoPopup(user);
    try {
      const res = await fetch(`/api/users/${encodeURIComponent(user.username)}/info`);
      if (res.ok) {
        const data = await res.json();
        setNodeInfoData(data);
      } else {
        const codename = user.username.split(' [NODE-')[0];
        setNodeInfoData({ codename, passcode: '0000', username: user.username, created: user.connectedAt });
      }
    } catch {
      const codename = user.username.split(' [NODE-')[0];
      setNodeInfoData({ codename, passcode: '0000', username: user.username, created: user.connectedAt });
    }
  };

  const handleToggleFolderExpansion = (msgId: string) => {
    setExpandedFolders(prev => ({ ...prev, [msgId]: !prev[msgId] }));
  };

  const handleDownloadFolderAsZip = async (msg: ChatMessage) => {
    if (!msg.payload) return;
    try {
      const files = JSON.parse(msg.payload);
      const zip = new JSZip();
      for (const file of files) {
        const base64Data = file.base64.split(',')[1] || file.base64;
        zip.file(file.path || file.name, base64Data, { base64: true });
      }
      const blob = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${msg.fileName || 'workspace'}.zip`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('ZIP creation failed', err);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      onSendFile(file.name, file.size, reader.result as string);
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

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
      uploadedItems.push({ name: file.name, size: file.size, path: pathValue, base64 });
    }
    onSendFolder(folderLabel, cumulativeSize, uploadedItems);
    e.target.value = '';
  };

  const handleStartVoiceRecord = async () => {
    try {
      setRecDuration(0);
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioStreamRef.current = stream;
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      const audioChunks: Blob[] = [];
      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) audioChunks.push(event.data);
      };
      mediaRecorder.onstop = () => {
        const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
        const reader = new FileReader();
        reader.onloadend = () => {
          onSendVoice(reader.result as string);
        };
        reader.readAsDataURL(audioBlob);
        stream.getTracks().forEach(track => track.stop());
      };
      mediaRecorder.start();
      setIsRecording(true);
      audioIntervalRef.current = setInterval(() => {
        setRecDuration(prev => prev + 1);
      }, 1000);
    } catch (err) {
      console.error(err);
      alert("MICROPHONE ACCESS DENIED");
    }
  };

  const handleStopVoiceRecord = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      clearInterval(audioIntervalRef.current);
    }
  };

  const formatTime = (ts: number) => new Date(ts).toLocaleTimeString();

  const isGlobalChat = !selectedNode;
  const chatLabel = isGlobalChat ? 'NETSEC_OPERATIONAL_COMMS' : `PRIVATE: ${selectedNode}`;
  const filteredMessages = messages.filter(msg => msg.sender !== 'SYSTEM_DAEMON');

  return (
    <div id="terminal-interface-wrapper" className="flex flex-col h-screen bg-[#0A0A0A] text-[#E0E0E0] font-mono selection:bg-white selection:text-black select-none overflow-hidden text-xs">
      
      <header className="h-12 border-b border-[#333] flex items-center justify-between px-6 bg-[#0F0F0F] shrink-0">
        <div className="flex items-center gap-4">
          <div className="w-2 h-2 bg-white animate-pulse"></div>
          <span className="text-xs tracking-widest uppercase font-bold text-white">{chatLabel}</span>
        </div>
        <div className="text-[10px] opacity-40 uppercase tracking-[0.2em] hidden md:block">
          Connection: Established
        </div>
        <div className="text-[10px] text-gray-500 font-mono tracking-wider">
          NODE: SECURE
        </div>
      </header>

      <div className="flex-1 flex overflow-hidden">
        
        <aside className="w-64 border-r border-[#333] flex flex-col bg-[#080808] shrink-0">
          <div className="p-4 border-b border-[#333] bg-[#090909]">
            <div className="text-[10px] opacity-50 mb-0.5">CHANNEL</div>
            <div className="text-xs font-bold text-white tracking-tight truncate max-w-[180px]">
              {chatLabel}
            </div>
          </div>

          <div className="flex-1 p-4 overflow-y-auto space-y-4">
            <div>
              <div className="text-[10px] opacity-50 mb-3 uppercase tracking-wider font-bold">CHAMBERS</div>
              <button
                onClick={() => onSelectRoom('netsec-comms')}
                className={`w-full text-left text-xs py-2 px-2.5 transition flex items-center justify-between border cursor-pointer ${
                  isGlobalChat
                    ? 'bg-white text-black border-white font-bold'
                    : 'bg-transparent border-[#222] hover:bg-[#111] hover:border-[#444] text-[#B0B0B0]'
                }`}
              >
                <span className="truncate"># NETSEC_OPERATIONAL_COMMS</span>
                {isGlobalChat && <span className="text-[8px] font-mono">[LIVE]</span>}
              </button>
            </div>

            <div className="pt-2">
              <div className="text-[10px] opacity-30 mb-2 uppercase tracking-wider">ACTIVE_NET_NODES</div>
              <div className="space-y-2 text-[11px] font-mono">
                <div className="flex items-center gap-2 opacity-50">
                  <span className="w-1.5 h-1.5 bg-white"></span>
                  <span className="truncate text-gray-400">{anonymousName} (YOU)</span>
                </div>
                {activeUsers
                  .filter(u => u.username !== anonymousName)
                  .map((user) => {
                    const isPrivate = selectedNode === user.username;
                    return (
                      <button
                        key={user.username}
                        onClick={() => handleNodeClick(user)}
                        className={`w-full flex items-center gap-2 text-left cursor-pointer transition px-1 py-1 ${
                          isPrivate
                            ? 'bg-white/10 text-white'
                            : 'text-gray-500 hover:text-gray-300 hover:bg-[#111]'
                        }`}
                      >
                        <span className={`w-1.5 h-1.5 ${isPrivate ? 'bg-white' : 'border border-white/50'}`}></span>
                        <span className="truncate">{user.username}</span>
                        <span className="text-[8px] opacity-40 ml-auto">{formatTime(user.connectedAt)}</span>
                      </button>
                    );
                  })}
                {activeUsers.filter(u => u.username !== anonymousName).length === 0 && (
                  <div className="text-[10px] opacity-30 italic">No other nodes active</div>
                )}
              </div>
            </div>
          </div>

          <div className="p-4 border-t border-[#333] bg-[#050505]">
            <div className="text-[9px] opacity-40 leading-relaxed font-mono">
              ACCESS_CODE: 0000<br />
              ENCRYPTION: AES-256<br />
              DB_STATUS: {dbMode.toUpperCase()}<br />
              OPERATOR: {realName}
            </div>
          </div>
        </aside>

        <section className="flex-1 flex flex-col relative bg-[#0A0A0A] overflow-hidden">
          
          <div className="flex-1 p-6 space-y-2 overflow-y-auto">
            {filteredMessages.map((msg) => {
              const timestampFormatted = new Date(msg.timestamp).toLocaleTimeString();
              const isFolder = msg.type === 'folder';
              return (
                <div key={msg.id} className={isFolder ? '' : 'flex gap-2 items-baseline group cursor-pointer hover:bg-white/[0.03] px-1 rounded'}>
                  <div
                    className={isFolder ? '' : 'flex gap-2 items-baseline cursor-pointer hover:bg-white/[0.03] px-1 rounded'}
                    onClick={() => !isFolder && handleCopyToInput(msg.text)}
                    title={isFolder ? '' : 'Click to copy text'}
                  >
                    {!isFolder && (
                      <>
                        <span className="text-[10px] opacity-30 shrink-0">[{timestampFormatted}]</span>
                        <span className="text-xs font-bold text-white shrink-0">{msg.sender}:</span>
                        <span className="text-xs text-[#D0D0D0] leading-relaxed">
                          {msg.type === 'voice' && msg.payload ? (
                            <audio src={msg.payload} controls className="h-6 inline-block align-middle" />
                          ) : msg.type === 'file' ? (
                            <span className="text-gray-400">[FILE] {msg.fileName || msg.text}</span>
                          ) : (
                            msg.text
                          )}
                        </span>
                      </>
                    )}
                  </div>
                  {isFolder && (
                    <div className="border border-[#333] bg-[#111] p-2 max-w-md">
                      <div className="flex items-center gap-2 text-xs text-gray-400 mb-1">
                        <Folder className="w-3.5 h-3.5 shrink-0" />
                        <span className="font-bold text-white">{msg.fileName || 'folder'}</span>
                        <span className="text-[9px] opacity-40">({((msg.fileSize || 0) / 1024).toFixed(1)} KB)</span>
                      </div>
                      <div className="flex gap-2 mb-2">
                        <button
                          onClick={() => handleToggleFolderExpansion(msg.id)}
                          className="px-2 py-0.5 border border-[#444] text-[9px] hover:bg-white hover:text-black transition cursor-pointer"
                        >
                          {expandedFolders[msg.id] ? 'CLOSE FILES' : 'SHOW FILES'}
                        </button>
                        <button
                          onClick={() => handleDownloadFolderAsZip(msg)}
                          className="px-2 py-0.5 border border-[#444] text-[9px] hover:bg-white hover:text-black transition cursor-pointer flex items-center gap-1"
                        >
                          <Download className="w-2.5 h-2.5" /> ZIP DOWNLOAD
                        </button>
                      </div>
                      {expandedFolders[msg.id] && msg.payload && (() => {
                        try {
                          const nodes = JSON.parse(msg.payload);
                          return (
                            <div className="max-h-[200px] overflow-y-auto space-y-0.5 border-t border-[#333] pt-1">
                              {nodes.map((node: any, nIdx: number) => (
                                <div key={nIdx} className="flex items-center gap-1.5 text-[10px] py-0.5 opacity-70 hover:opacity-100">
                                  <File className="w-2.5 h-2.5 shrink-0" />
                                  <span className="truncate text-gray-400">{node.path || node.name}</span>
                                  <span className="text-[8px] opacity-40 ml-auto">{(node.size / 1024).toFixed(1)} KB</span>
                                </div>
                              ))}
                            </div>
                          );
                        } catch {
                          return <p className="text-red-500 text-[8px] mt-1">CORRUPT STRUCT PACKET</p>;
                        }
                      })()}
                    </div>
                  )}
                </div>
              );
            })}
            <div ref={logStreamEndRef} />
          </div>

          <div className="p-4 border-t border-[#333] bg-[#0A0A0A] shrink-0">
            {isBlocked && (
              <div className="mb-2 border border-red-900 bg-red-950/20 text-red-500 p-2 font-bold text-[10px] tracking-wider uppercase text-center animate-pulse">
                ACCESS SUSPENDED BY ADMIN
              </div>
            )}

            <form onSubmit={handleMessageFormSubmit} className="relative flex items-center border border-[#444] bg-[#111] p-2 sm:p-3 gap-3">
              <span className="text-white text-xs select-none">$</span>
              <input
                type="text"
                value={inputText}
                onChange={handleInputChange}
                disabled={isBlocked}
                placeholder={isBlocked ? "ACCESS SUSPENDED" : "Enter message..."}
                className="bg-transparent border-none outline-none flex-1 text-xs sm:text-sm text-white placeholder-[#2A2A2A] font-bold disabled:opacity-40"
                autoComplete="off"
              />

              <div className="flex items-center gap-1 sm:gap-2 px-2 border-l border-[#333] shrink-0">
                {/* Emoji picker */}
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setShowEmojiPicker(!showEmojiPicker)}
                    disabled={isBlocked}
                    className="p-2 border border-transparent hover:border-[#444] text-gray-400 hover:text-white hover:bg-[#1a1a1a] transition cursor-pointer text-sm leading-none disabled:opacity-20"
                    title="Emoji"
                  >
                    😀
                  </button>
                  {showEmojiPicker && (
                    <div
                      ref={emojiPickerRef}
                      className="absolute bottom-full right-0 mb-2 p-2 bg-[#1a1a1a] border border-[#444] grid grid-cols-8 gap-1 max-w-[280px] z-50"
                    >
                      {EMOJIS.map((emoji, i) => (
                        <button
                          key={i}
                          type="button"
                          onClick={() => handleEmojiClick(emoji)}
                          className="text-lg hover:bg-white/10 p-1 leading-none cursor-pointer"
                        >
                          {emoji}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Voice */}
                <button
                  type="button"
                  onClick={isRecording ? handleStopVoiceRecord : handleStartVoiceRecord}
                  disabled={isBlocked}
                  className={`p-2 border transition cursor-pointer shrink-0 disabled:opacity-20 ${
                    isRecording
                      ? 'border-white bg-white text-black animate-pulse'
                      : 'border-transparent text-gray-400 hover:text-white hover:border-[#444] hover:bg-[#1a1a1a]'
                  }`}
                  title={isRecording ? `Stop (${recDuration}s)` : 'Voice Note'}
                >
                  {isRecording ? <Square className="w-3.5 h-3.5" /> : <Mic className="w-3.5 h-3.5" />}
                  {isRecording && <span className="ml-1 text-[8px] font-bold">{recDuration}s</span>}
                </button>

                {/* File */}
                <label className={`p-2 border border-transparent hover:border-[#444] text-gray-400 hover:text-white hover:bg-[#1a1a1a] transition cursor-pointer shrink-0 ${isBlocked ? 'pointer-events-none opacity-20' : ''}`} title="Attach File">
                  <Paperclip className="w-3.5 h-3.5" />
                  <input type="file" onChange={handleFileChange} disabled={isBlocked} className="hidden" />
                </label>

                {/* Folder */}
                <label className={`p-2 border border-transparent hover:border-[#444] text-gray-400 hover:text-white hover:bg-[#1a1a1a] transition cursor-pointer shrink-0 ${isBlocked ? 'pointer-events-none opacity-20' : ''}`} title="Attach Folder">
                  <FolderUp className="w-3.5 h-3.5" />
                  <input type="file" multiple {...({ webkitdirectory: "", directory: "" } as any)} onChange={handleFolderChange} disabled={isBlocked} className="hidden" />
                </label>

                {/* Send */}
                <button
                  type="submit"
                  disabled={!inputText.trim() || isBlocked}
                  className="p-2 border border-transparent hover:border-[#444] text-gray-400 hover:text-white hover:bg-[#1a1a1a] transition cursor-pointer disabled:opacity-20 shrink-0"
                  title="Send"
                >
                  <Send className="w-3.5 h-3.5" />
                </button>
              </div>
            </form>
          </div>

        </section>

      </div>

      {nodeInfoPopup && nodeInfoData && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center" onClick={() => { setNodeInfoPopup(null); setNodeInfoData(null); }}>
          <div className="border border-[#444] bg-[#0F0F0F] p-6 max-w-md w-full mx-4 shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-4">
              <span className="text-[10px] uppercase tracking-widest text-gray-400 font-bold">NODE INTELLIGENCE</span>
              <button onClick={() => { setNodeInfoPopup(null); setNodeInfoData(null); }} className="text-gray-500 hover:text-white cursor-pointer">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="space-y-3 text-xs">
              <div className="border-b border-[#222] pb-2">
                <div className="text-[9px] opacity-40 uppercase tracking-wider mb-0.5">OPERATOR CODENAME</div>
                <div className="text-white font-bold text-sm">{nodeInfoData.codename}</div>
              </div>
              <div className="border-b border-[#222] pb-2">
                <div className="text-[9px] opacity-40 uppercase tracking-wider mb-0.5">FULL NODE IDENTIFIER</div>
                <div className="text-white">{nodeInfoData.username}</div>
              </div>
              <div className="border-b border-[#222] pb-2">
                <div className="text-[9px] opacity-40 uppercase tracking-wider mb-0.5">DECRYPTION INTERPASSCODE</div>
                <div className="text-white tracking-[0.3em] font-bold">{nodeInfoData.passcode}</div>
              </div>
              <div className="pb-2">
                <div className="text-[9px] opacity-40 uppercase tracking-wider mb-0.5">NODE CONNECTED AT</div>
                <div className="text-white">{new Date(nodeInfoPopup.connectedAt).toLocaleTimeString()}</div>
              </div>
            </div>
            <button
              onClick={() => { onSelectNode(nodeInfoPopup.username); setNodeInfoPopup(null); setNodeInfoData(null); }}
              className="w-full mt-6 bg-white text-black hover:bg-black hover:text-white border border-white font-bold py-2.5 px-4 transition uppercase tracking-widest text-[10px] cursor-pointer"
            >
              OPEN PRIVATE CHANNEL
            </button>
          </div>
        </div>
      )}

      <footer className="h-6 bg-white text-black flex items-center justify-between px-4 text-[9px] font-bold uppercase tracking-widest shrink-0 select-none">
        <div>NODE_STATUS: {isBlocked ? "SUSPENDED" : "ACTIVE"}</div>
        <div>ENCRYPT_LAYER: ON</div>
      </footer>

    </div>
  );
}

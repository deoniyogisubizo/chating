import React, { useState, useEffect, useRef } from 'react';
import { Send, Mic, Square, Paperclip, FolderUp, Folder, File, Download, Play } from 'lucide-react';
import JSZip from 'jszip';
import { ChatMessage, ChatSession } from '../types';

const EMOJIS = ['😀','😁','😂','🤣','😃','😄','😅','😆','😉','😊','😋','😎','😍','🥰','😘','🤗','🤩','👍','👎','👊','✊','🤛','🤜','👏','🙌','❤️','💔','🔥','💯','🎉','🎊','💀','☠️','✅','❌','❓','❗','💡','📌','🔒','🔓','⭐','🌟','💪','🖕','🤝','🙏','🚀','💀'];

interface TerminalConsoleProps {
  realName: string;
  anonymousName: string;
  messages: ChatMessage[];
  typingUsers: string[];
  dbMode: string;
  activeUsers: Array<{ username: string; connectedAt: number }>;
  onSendMessage: (text: string) => void;
  onSendFile: (fileName: string, fileSize: number, base64: string) => void;
  onSendFolder: (folderName: string, totalSize: number, files: any[]) => void;
  onSendVoice: (base64Audio: string) => void;
  onTypingEvent: (isTyping: boolean) => void;
  onLoadAdmin: () => void;
  isBlocked: boolean;
  activeSession: ChatSession | null;
}

export default function TerminalConsole({
  realName,
  anonymousName,
  messages,
  typingUsers,
  dbMode,
  activeUsers,
  onSendMessage,
  onSendFile,
  onSendFolder,
  onSendVoice,
  onTypingEvent,
  onLoadAdmin,
  isBlocked,
  activeSession
}: TerminalConsoleProps) {
  const [inputText, setInputText] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const [recDuration, setRecDuration] = useState(0);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [expandedFolders, setExpandedFolders] = useState<Record<string, boolean>>({});
  const [activeMsgMenu, setActiveMsgMenu] = useState<string | null>(null);
  const [replyTo, setReplyTo] = useState<{ sender: string; text: string; msgId: string } | null>(null);
  const typingTimeoutRef = useRef<any>(null);
  const logStreamEndRef = useRef<HTMLDivElement | null>(null);
  const msgMenuRef = useRef<HTMLDivElement | null>(null);
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
      if (msgMenuRef.current && !msgMenuRef.current.contains(e.target as Node)) {
        setActiveMsgMenu(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInputText(e.target.value);
    onTypingEvent(true);
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => onTypingEvent(false), 1500);
  };

  const handleMessageFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim()) return;
    onTypingEvent(false);
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    onSendMessage(inputText);
    setInputText('');
    setReplyTo(null);
  };

  const handleEmojiClick = (emoji: string) => {
    setInputText(prev => prev + emoji);
    setShowEmojiPicker(false);
  };

  const handleCopyToInput = (text: string) => {
    setInputText(text);
  };

  const handleCopyMessage = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    setActiveMsgMenu(null);
  };

  const handleReplyMessage = (sender: string, text: string, msgId: string) => {
    setReplyTo({ sender, text, msgId });
    setActiveMsgMenu(null);
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

  const handleDownloadFile = (msg: ChatMessage) => {
    if (!msg.payload) return;
    const base64Data = msg.payload.split(',')[1] || msg.payload;
    const mimeType = msg.payload.split(',')[0]?.match(/:(.*?);/)?.[1] || 'application/octet-stream';
    const byteChars = atob(base64Data);
    const byteArrays = [];
    for (let offset = 0; offset < byteChars.length; offset += 512) {
      const slice = byteChars.slice(offset, offset + 512);
      const byteNumbers = new Array(slice.length);
      for (let i = 0; i < slice.length; i++) {
        byteNumbers[i] = slice.charCodeAt(i);
      }
      byteArrays.push(new Uint8Array(byteNumbers));
    }
    const blob = new Blob(byteArrays, { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = msg.fileName || 'download';
    a.click();
    URL.revokeObjectURL(url);
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

  const filteredMessages = messages.filter(msg => msg.sender !== 'SYSTEM_DAEMON');

  return (
    <div id="terminal-interface-wrapper" className="flex flex-col h-screen bg-[#0A0A0A] text-[#E0E0E0] font-mono selection:bg-white selection:text-black select-none overflow-hidden text-xs">
      
      <header className="h-12 border-b border-[#333] flex items-center justify-between px-6 bg-[#0F0F0F] shrink-0">
        <div className="flex items-center gap-4">
          <div className="w-2 h-2 bg-white animate-pulse"></div>
          <span className="text-xs tracking-widest uppercase font-bold text-white">NETSEC_OPERATIONAL_COMMS</span>
          {activeSession && (
            <span className="text-[9px] text-emerald-400 border border-emerald-900 px-1.5 py-0.5 font-bold uppercase tracking-wider flex items-center gap-1">
              <Play className="w-2.5 h-2.5" /> SESSION: {activeSession.name}
            </span>
          )}
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
              NETSEC_OPERATIONAL_COMMS
            </div>
          </div>

          <div className="flex-1 p-4 overflow-y-auto space-y-4">
            <div>
              <div className="text-[10px] opacity-30 mb-2 uppercase tracking-wider">ACTIVE_NET_NODES</div>
              <div className="space-y-2 text-[11px] font-mono">
                <div className="flex items-center gap-2 opacity-50">
                  <span className="w-1.5 h-1.5 bg-white"></span>
                  <span className="truncate text-gray-400">{anonymousName} (YOU)</span>
                </div>
                {activeUsers
                  .filter(u => u.username !== anonymousName)
                  .map((user) => (
                    <div key={user.username} className="flex items-center gap-2 text-gray-500 px-1 py-1">
                      <span className="w-1.5 h-1.5 border border-white/50"></span>
                      <span className="truncate">{user.username}</span>
                      <span className="text-[8px] opacity-40 ml-auto">{formatTime(user.connectedAt)}</span>
                    </div>
                  ))}
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
              const displayText = msg.type === 'file' ? `[FILE] ${msg.fileName || msg.text}` : msg.text;
              return (
                <div key={msg.id} className={`group flex ${isFolder ? 'flex-col' : 'items-baseline gap-2'} px-1 rounded relative ${replyTo?.msgId === msg.id ? 'bg-white/10 ring-1 ring-white/20' : 'hover:bg-white/[0.03]'}`}>
                  {!isFolder && (
                    <>
                      <span className="text-[10px] opacity-30 shrink-0">[{timestampFormatted}]</span>
                      <span className="text-xs font-bold text-white shrink-0">{msg.sender}:</span>
                      <span className="text-xs text-[#D0D0D0] leading-relaxed">
                        {msg.type === 'voice' && msg.payload ? (
                          <audio src={msg.payload} controls className="h-6 inline-block align-middle" />
                        ) : msg.type === 'file' ? (
                          <span className="text-gray-400 inline-flex items-center gap-1.5">
                            [FILE] {msg.fileName || msg.text}
                            <button
                              onClick={(e) => { e.stopPropagation(); handleDownloadFile(msg); }}
                              className="px-1.5 py-0.5 border border-[#444] text-[9px] hover:bg-white hover:text-black transition cursor-pointer inline-flex items-center gap-0.5"
                              title="Download file"
                            >
                              <Download className="w-2 h-2" /> GET
                            </button>
                          </span>
                        ) : (
                          msg.text
                        )}
                        <button
                          onClick={(e) => { e.stopPropagation(); setActiveMsgMenu(activeMsgMenu === msg.id ? null : msg.id); }}
                          className="opacity-0 group-hover:opacity-100 transition-opacity ml-1 px-1 border border-transparent hover:border-[#444] text-gray-500 hover:text-white cursor-pointer text-xs leading-none align-baseline"
                          title="Message actions"
                        >
                          ...
                        </button>
                        {activeMsgMenu === msg.id && (
                          <div ref={msgMenuRef} className="absolute left-0 top-full mt-1 z-50 bg-[#1a1a1a] border border-[#444] min-w-[100px] shadow-xl">
                            <button
                              onClick={(e) => { e.stopPropagation(); handleReplyMessage(msg.sender, displayText, msg.id); }}
                              className="w-full text-left px-3 py-1.5 text-[10px] text-gray-300 hover:bg-white hover:text-black transition cursor-pointer"
                            >
                              REPLY
                            </button>
                            <button
                              onClick={(e) => { e.stopPropagation(); handleCopyMessage(displayText); }}
                              className="w-full text-left px-3 py-1.5 text-[10px] text-gray-300 hover:bg-white hover:text-black transition cursor-pointer"
                            >
                              COPY
                            </button>
                          </div>
                        )}
                      </span>
                    </>
                  )}
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

          {typingUsers.length > 0 && (
            <div className="px-4 py-1 border-t border-[#333] bg-[#0A0A0A] text-[10px] text-gray-500 italic">
              [!] {typingUsers.join(', ')} {typingUsers.length === 1 ? 'is' : 'are'} typing...
            </div>
          )}

          <div className="p-4 border-t border-[#333] bg-[#0A0A0A] shrink-0">
            {isBlocked && (
              <div className="mb-2 border border-red-900 bg-red-950/20 text-red-500 p-2 font-bold text-[10px] tracking-wider uppercase text-center animate-pulse">
                ACCESS SUSPENDED BY ADMIN
              </div>
            )}

            {replyTo && (
              <div className="mb-2 border-l-2 border-white/30 bg-[#111] px-3 py-1.5 flex items-center gap-2 text-[10px]">
                <span className="text-white font-bold shrink-0">{replyTo.sender}</span>
                <span className="text-gray-400 truncate flex-1">{replyTo.text}</span>
                <button
                  onClick={() => setReplyTo(null)}
                  className="text-gray-500 hover:text-white transition cursor-pointer shrink-0 px-1"
                  title="Cancel reply"
                >
                  X
                </button>
              </div>
            )}

            <form onSubmit={handleMessageFormSubmit} className="relative flex items-center border border-[#444] bg-[#111] p-2 sm:p-3 gap-3">
              <span className="text-white text-xs select-none">$</span>
              <input
                type="text"
                value={inputText}
                onChange={handleInputChange}
                onBlur={() => { onTypingEvent(false); if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current); }}
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

      <footer className="h-6 bg-white text-black flex items-center justify-between px-4 text-[9px] font-bold uppercase tracking-widest shrink-0 select-none">
        <div>NODE_STATUS: {isBlocked ? "SUSPENDED" : "ACTIVE"}</div>
        <div>ENCRYPT_LAYER: ON</div>
      </footer>

    </div>
  );
}

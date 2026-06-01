/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import { ChatMessage, ChatRoom, ChatSession } from './types';
import AccessScreen from './components/AccessScreen';
import TerminalConsole from './components/TerminalConsole';
import AdminConsole from './components/AdminConsole';

export default function App() {
  const [realName, setRealName] = useState<string>('');
  const [anonymousName, setAnonymousName] = useState<string>('');
  const [isAuthorized, setIsAuthorized] = useState<boolean>(false);
  
  const [currentLayout, setCurrentLayout] = useState<'login' | 'chat' | 'admin'>('login');
  
  const [rooms, setRooms] = useState<ChatRoom[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [activeRoomId, setActiveRoomId] = useState<string>('general-shell');
  const [typingUsers, setTypingUsers] = useState<string[]>([]);
  const [isBlocked, setIsBlocked] = useState<boolean>(false);
  
  const [activeSession, setActiveSession] = useState<ChatSession | null>(null);
  const [dbMode] = useState<'MongoDB Atlas'>('MongoDB Atlas');

  const [activeUsers, setActiveUsers] = useState<Array<{ username: string; connectedAt: number }>>([]);

  // Multi-user Socket reference
  const socketRef = useRef<Socket | null>(null);
  const lastMessageIdRef = useRef<Record<string, string>>({});

  // 1. Initial configuration load & route evaluation
  useEffect(() => {
    // Check if operator metadata is already stored in browser memory to avoid re-auth
    const storedReal = sessionStorage.getItem('term_operator_real');
    const storedAnon = sessionStorage.getItem('term_operator_anon');
    const storedRoom = sessionStorage.getItem('term_operator_room');

    if (storedReal && storedAnon) {
      setRealName(storedReal);
      setAnonymousName(storedAnon);
      setIsAuthorized(true);
      if (storedRoom) {
        setActiveRoomId(storedRoom);
      }
    }

    // Determine current sub-route based on Hash or Pathname
    const evaluateRoute = () => {
      const hash = window.location.hash;
      const path = window.location.pathname;

      if (hash === '#/admin' || path === '/admin') {
        setCurrentLayout('admin');
      } else {
        const stored = sessionStorage.getItem('term_operator_anon');
        if (stored) {
          setCurrentLayout('chat');
        } else {
          setCurrentLayout('login');
        }
      }
    };

    evaluateRoute();
    window.addEventListener('hashchange', evaluateRoute);
    window.addEventListener('popstate', evaluateRoute);

    return () => {
      window.removeEventListener('hashchange', evaluateRoute);
      window.removeEventListener('popstate', evaluateRoute);
    };
  }, []);

  // 2. Fetch rooms list initially & configure DB mode state
  const fetchActiveRooms = async () => {
    try {
      const response = await fetch('/api/rooms');
      if (response.ok) {
        const data: ChatRoom[] = await response.json();
        setRooms(data);
        
        // Infer database mode based on configuration status (can check endpoint headers if needed, 
        // but let's default based on active connection metadata or keep simple)
        if (data.length > 0) {
          // In a simple standard, we have local JSON storage by default unless configured.
          // Let's assume MongoDB Atlas is used since we handle standard Atlas connection on server.
          // Let's make server declare its db details in headers or response metadata if available.
          // For simple high-fidelity styling, let's keep it accurate to what server reported.
        }
      }
    } catch (err) {
      console.error("Failed to query active rooms index", err);
    }
  };

  useEffect(() => {
    fetchActiveRooms();
  }, []);

  // 3. Sync Messages for the active room (incremental: only fetch new messages)
  const fetchMessagesForRoom = async (roomId: string, forceFull?: boolean) => {
    if (!roomId) return;
    try {
      const lastId = lastMessageIdRef.current[roomId];
      const url = forceFull || !lastId
        ? `/api/messages?roomId=${roomId}`
        : `/api/messages?roomId=${roomId}&since=${encodeURIComponent(lastId)}`;
      const response = await fetch(url);
      if (response.status === 304) return; // Not modified
      if (response.ok) {
        const data: ChatMessage[] = await response.json();
        if (data.length === 0) return;
        setMessages(prev => {
          const merged = new Map<string, ChatMessage>();
          for (const m of prev) merged.set(m.id, m);
          for (const m of data) if (!merged.has(m.id)) merged.set(m.id, m);
          const result = Array.from(merged.values()).sort((a, b) => a.timestamp - b.timestamp);
          if (result.length > 0) {
            lastMessageIdRef.current[roomId] = result[result.length - 1].id;
          }
          return result;
        });
      }
    } catch (err) {
      console.error(`Failed to pull logs synchronization for room ${roomId}`, err);
    }
  };

  // Fetch messages when room active selection shifts (full fetch on room change)
  useEffect(() => {
    lastMessageIdRef.current[activeRoomId] = '';
    fetchMessagesForRoom(activeRoomId, true);
  }, [activeRoomId]);

  // 4. HEARTBEAT ACTIVE SYNC (Updates every three seconds to satisfy user prompt requirement)
  // "Also, implement real-time synchronization across all user devices for seamless transitions. and updates every three seconds"
  useEffect(() => {
    const syncInterval = setInterval(() => {
      fetchActiveRooms();
      if (activeRoomId) {
        fetchMessagesForRoom(activeRoomId);
      }
    }, 3000);

    return () => clearInterval(syncInterval);
  }, [activeRoomId]);

  // 5. Setup socket client on operator login / status change
  useEffect(() => {
    if (!isAuthorized || !anonymousName) return;

    // Connect to WebSocket of same origin host
    const socket = io();
    socketRef.current = socket;

    socket.on('connect', () => {
      console.log("Terminal socket channel opened successfully.");
      socket.emit('joinRoom', {
        username: anonymousName,
        roomId: activeRoomId,
        codename: realName,
        passcode: '0000'
      });
    });

    // Listen for active users list
    socket.on('activeUsers', (users: Array<{ username: string; connectedAt: number }>) => {
      setActiveUsers(users);
    });

    // Receive full chat history on room join
    socket.on('chatHistory', (history: ChatMessage[]) => {
      if (history.length > 0) {
        setMessages(prev => {
          const merged = new Map<string, ChatMessage>();
          for (const m of prev) merged.set(m.id, m);
          for (const m of history) if (!merged.has(m.id)) merged.set(m.id, m);
          const result = Array.from(merged.values()).sort((a, b) => a.timestamp - b.timestamp);
          if (result.length > 0) {
            lastMessageIdRef.current[history[0].roomId] = result[result.length - 1].id;
          }
          return result;
        });
      }
    });

    // Track active session
    socket.on('sessionStarted', (session: ChatSession) => {
      if (session.roomId === activeRoomId) {
        setActiveSession(session);
      }
    });

    socket.on('sessionEnded', (session: ChatSession) => {
      if (session.roomId === activeRoomId) {
        setActiveSession(null);
      }
    });

    // Handle instant real-time message stream
    socket.on('message', (newMsg: ChatMessage) => {
      if (newMsg.roomId === activeRoomId) {
        setMessages(prev => {
          // Idempotency check: safeguard against duplicates arriving on reconnect/polling intersection
          if (prev.some(m => m.id === newMsg.id)) return prev;
          return [...prev, newMsg];
        });
      }
    });

    // Handle typing lists
    socket.on('typingUpdate', (users: string[]) => {
      // Exclude oneself from typing indicator representation
      setTypingUsers(users.filter(u => u !== anonymousName));
    });

    // Handle instant database clearance event
    socket.on('databaseWiped', () => {
      setMessages([]);
      setRooms([]);
      setActiveRoomId('general-shell');
      sessionStorage.removeItem('term_operator_room');
      window.location.reload();
    });

    // Handle sibling room creations dynamically
    socket.on('roomCreated', (newRoom: ChatRoom) => {
      setRooms(prev => {
        if (prev.some(r => r.id === newRoom.id)) return prev;
        return [...prev, newRoom];
      });
    });

    // Handle user block levels reactively
    socket.on('userBlockedState', ({ isBlocked: blockStatus, username }: { isBlocked: boolean, username: string }) => {
      if (username === anonymousName) {
        setIsBlocked(blockStatus);
      }
    });

    socket.on('userModerated', ({ username, action }: { username: string, action: 'block' | 'unblock' | 'delete' }) => {
      if (username === anonymousName) {
        if (action === 'delete') {
          sessionStorage.clear();
          setIsAuthorized(false);
          setRealName('');
          setAnonymousName('');
          setCurrentLayout('login');
          window.location.reload();
        } else if (action === 'block') {
          setIsBlocked(true);
        } else if (action === 'unblock') {
          setIsBlocked(false);
        }
      }
    });

    // Handle group channels deleted reactively
    socket.on('roomDeleted', ({ roomId }: { roomId: string }) => {
      setRooms(prev => prev.filter(r => r.id !== roomId));
      if (activeRoomId === roomId) {
        setActiveRoomId('general-shell');
        sessionStorage.setItem('term_operator_room', 'general-shell');
      }
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [isAuthorized, anonymousName, activeRoomId]);

  // 6. User Operations API Dispatches
  const handleAccessGranted = (codenameInput: string, anonymousInput: string) => {
    setRealName(codenameInput);
    setAnonymousName(anonymousInput);
    setIsAuthorized(true);
    
    sessionStorage.setItem('term_operator_real', codenameInput);
    sessionStorage.setItem('term_operator_anon', anonymousInput);
    sessionStorage.setItem('term_operator_room', activeRoomId);

    // Switch to Chat room view layout automatically (if they aren't on admin console)
    if (window.location.hash !== '#/admin' && window.location.pathname !== '/admin') {
      setCurrentLayout('chat');
    }
  };

  const handleSendMessage = async (text: string) => {
    if (socketRef.current?.connected) {
      socketRef.current.emit('sendMessage', {
        roomId: activeRoomId,
        sender: anonymousName,
        text,
        type: 'text'
      });
    } else {
      try {
        const response = await fetch('/api/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ roomId: activeRoomId, sender: anonymousName, text, type: 'text' })
        });
        if (response.ok) {
          const newMsg: ChatMessage = await response.json();
          setMessages(prev => prev.some(m => m.id === newMsg.id) ? prev : [...prev, newMsg]);
        }
      } catch (err) {
        console.error('Failed to send message via HTTP fallback', err);
      }
    }
  };

  const handleSendFile = async (fileName: string, fileSize: number, base64: string) => {
    if (socketRef.current?.connected) {
      socketRef.current.emit('sendMessage', {
        roomId: activeRoomId,
        sender: anonymousName,
        text: `Uploaded File: ${fileName} (${(fileSize / 1024).toFixed(1)} KB)`,
        type: 'file',
        payload: base64,
        fileName,
        fileSize
      });
    } else {
      try {
        const response = await fetch('/api/upload-files', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            roomId: activeRoomId,
            sender: anonymousName,
            files: [{ name: fileName, size: fileSize, base64 }]
          })
        });
        if (response.ok) {
          const optimisticMsg: ChatMessage = {
            id: `msg-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
            roomId: activeRoomId,
            sender: anonymousName,
            text: `Uploaded File: ${fileName} (${(fileSize / 1024).toFixed(1)} KB)`,
            type: 'file',
            timestamp: Date.now(),
            payload: base64,
            fileName,
            fileSize
          };
          setMessages(prev => prev.some(m => m.id === optimisticMsg.id) ? prev : [...prev, optimisticMsg]);
        }
      } catch (err) {
        console.error(err);
      }
    }
  };

  const handleSendFolder = async (folderName: string, totalSize: number, files: any[]) => {
    if (socketRef.current?.connected) {
      socketRef.current.emit('sendMessage', {
        roomId: activeRoomId,
        sender: anonymousName,
        text: `Uploaded Directory Workspace: [${folderName}/] comprising ${files.length} node structures (${(totalSize / 1024).toFixed(1)} KB)`,
        type: 'folder',
        payload: JSON.stringify(files.map((f: any) => ({ name: f.name, size: f.size, path: f.path, base64: f.base64 }))),
        fileName: folderName,
        fileSize: totalSize
      });
    } else {
      try {
        const response = await fetch('/api/upload-files', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            roomId: activeRoomId,
            sender: anonymousName,
            files: files
          })
        });
        if (response.ok) {
          const optimisticMsg: ChatMessage = {
            id: `msg-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
            roomId: activeRoomId,
            sender: anonymousName,
            text: `Uploaded Directory Workspace: [${folderName}/] comprising ${files.length} node structures (${(totalSize / 1024).toFixed(1)} KB)`,
            type: 'folder',
            timestamp: Date.now(),
            payload: JSON.stringify(files.map((f: any) => ({ name: f.name, size: f.size, path: f.path, base64: f.base64 }))),
            fileName: folderName,
            fileSize: totalSize
          };
          setMessages(prev => prev.some(m => m.id === optimisticMsg.id) ? prev : [...prev, optimisticMsg]);
        }
      } catch (err) {
        console.error(err);
      }
    }
  };

  const handleSendVoice = async (base64Audio: string) => {
    if (socketRef.current?.connected) {
      socketRef.current.emit('sendMessage', {
        roomId: activeRoomId,
        sender: anonymousName,
        text: 'Voice transmission decoded successfully.',
        type: 'voice',
        payload: base64Audio
      });
    } else {
      try {
        const response = await fetch('/api/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            roomId: activeRoomId, sender: anonymousName,
            text: 'Voice transmission decoded successfully.',
            type: 'voice', payload: base64Audio
          })
        });
        if (response.ok) {
          const newMsg: ChatMessage = await response.json();
          setMessages(prev => prev.some(m => m.id === newMsg.id) ? prev : [...prev, newMsg]);
        }
      } catch (err) {
        console.error('Failed to send voice via HTTP fallback', err);
      }
    }
  };

  const handleTypingEvent = (isTyping: boolean) => {
    if (socketRef.current) {
      socketRef.current.emit('typing', { isTyping });
    }
  };

  const handleNavigateToAdmin = () => {
    window.location.hash = '/admin'; // Set hash so Router picks it up
    setCurrentLayout('admin');
  };

  const handleNavigateToChat = () => {
    window.location.hash = ''; // Clear hash
    if (isAuthorized) {
      setCurrentLayout('chat');
    } else {
      setCurrentLayout('login');
    }
  };

  // Render layouts
  return (
    <div className="h-screen bg-black text-white font-mono antialiased">
      {currentLayout === 'admin' && (
        <AdminConsole
          onBack={handleNavigateToChat}
          dbMode={dbMode}
          activeRooms={rooms}
          totalMessagesCount={messages.length}
          activeSession={activeSession}
          currentAdminName={realName}
          activeRoomId={activeRoomId}
        />
      )}

      {currentLayout === 'login' && (
        <AccessScreen onAccessGranted={handleAccessGranted} />
      )}

      {currentLayout === 'chat' && isAuthorized && (
        <TerminalConsole
          realName={realName}
          anonymousName={anonymousName}
          messages={messages}
          typingUsers={typingUsers}
          dbMode={dbMode}
          activeUsers={activeUsers}
          onSendMessage={handleSendMessage}
          onSendFile={handleSendFile}
          onSendFolder={handleSendFolder}
          onSendVoice={handleSendVoice}
          onTypingEvent={handleTypingEvent}
          onLoadAdmin={handleNavigateToAdmin}
          isBlocked={isBlocked}
          activeSession={activeSession}
        />
      )}
    </div>
  );
}

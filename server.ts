/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import express from 'express';
import http from 'http';
import { Server as SocketServer } from 'socket.io';
import { MongoClient, Db } from 'mongodb';
import path from 'path';
import dotenv from 'dotenv';
import { createServer as createViteServer } from 'vite';
import compression from 'compression';
import crypto from 'crypto';
import { ChatMessage, ChatRoom, ChatSession } from './src/types';

dotenv.config();

const FILES_RETENTION_DAYS = 10;
const FILES_RETENTION_MS = FILES_RETENTION_DAYS * 24 * 60 * 60 * 1000;
const CACHE_MAX_MESSAGES = 200;

async function startServer() {
  const app = express();
  const PORT = 3000;
  const server = http.createServer(app);

  const io = new SocketServer(server, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST']
    },
    maxHttpBufferSize: 1e8
  });

  app.use(express.json({ limit: '100mb' }));
  app.use(express.urlencoded({ limit: '100mb', extended: true }));
  app.use(compression());

  // MongoDB Atlas Setup
  let mongoClient: MongoClient | null = null;
  let mongoDb: Db | null = null;

  const mongoUriStr = process.env.MONGODB_URI || '';
  const isMongoConfigured = mongoUriStr && !mongoUriStr.includes('<username>') && mongoUriStr.trim() !== '';

  // In-memory cache for recent messages per room
  const messageCache = new Map<string, { messages: ChatMessage[], lastFetched: number }>();

  function bustMessageCache(roomId: string) {
    messageCache.delete(roomId);
  }

  function updateMessageCache(roomId: string, msg: ChatMessage) {
    const cached = messageCache.get(roomId);
    if (cached) {
      cached.messages.push(msg);
      if (cached.messages.length > CACHE_MAX_MESSAGES) {
        cached.messages = cached.messages.slice(-CACHE_MAX_MESSAGES);
      }
    }
  }

  // Database initialization - REQUIRED, no fallback
  if (!isMongoConfigured) {
    console.error("FATAL: MONGODB_URI is not configured. Set MONGODB_URI in .env or Vercel environment variables.");
    console.error("Expected format: mongodb+srv://<user>:<pass>@cluster.mongodb.net/");
    process.exit(1);
  }

  try {
    console.log("Initializing secure connection to MongoDB Atlas cluster...");
    mongoClient = new MongoClient(mongoUriStr, {
      serverSelectionTimeoutMS: 10000,
      connectTimeoutMS: 10000,
    });
    await mongoClient.connect();
    mongoDb = mongoClient.db('chating');
    console.log("MongoDB Atlas cluster linked successfully.");

    // Setup TTL indexes for automatic file cleanup (10 days)
    try {
      await mongoDb.collection('messages').createIndex({ timestamp: 1 }, { expireAfterSeconds: 0 });
    } catch {
      // Index may already exist with different options, that's fine
    }

    // Setup index for room queries
    await mongoDb.collection('messages').createIndex({ roomId: 1, timestamp: -1 });
    await mongoDb.collection('messages').createIndex({ sessionId: 1 });
    await mongoDb.collection('sessions').createIndex({ createdAt: -1 });
    await mongoDb.collection('sessions').createIndex({ roomId: 1, active: 1 });

    // Bootstrap default rooms if empty
    const roomsCol = mongoDb.collection('rooms');
    const count = await roomsCol.countDocuments();
    if (count === 0) {
      await roomsCol.insertMany([
        { id: 'general-shell', name: 'SECURE_GENERAL_SHELL', created: Date.now(), active: true },
        { id: 'netsec-comms', name: 'NETSEC_OPERATIONAL_COMMS', created: Date.now(), active: true }
      ]);
      const messagesCol = mongoDb.collection('messages');
      await messagesCol.insertOne({
        id: 'init-msg-1',
        roomId: 'general-shell',
        sender: 'SYSTEM_DAEMON',
        text: 'Terminal initialized in MongoDB Atlas. System status: SECURE. Monochromatic environment online.',
        type: 'text',
        timestamp: Date.now()
      });
      console.log("Bootstrapped default chambers in MongoDB Atlas.");
    }
  } catch (e) {
    console.error("FATAL: MongoDB Atlas connection failed. Database is required.", e);
    process.exit(1);
  }

  // Get the active session for a room (the one not closed)
  async function getActiveSession(roomId: string): Promise<ChatSession | null> {
    if (!mongoDb) return null;
    const session = await mongoDb.collection('sessions').findOne({ roomId, active: true });
    if (!session) return null;
    return {
      id: session.id,
      name: session.name,
      createdBy: session.createdBy,
      createdAt: session.createdAt,
      closedAt: session.closedAt,
      active: session.active,
      roomId: session.roomId,
      messageCount: session.messageCount || 0
    };
  }

  // Clean old file payloads (runs periodically)
  async function cleanExpiredFilePayloads() {
    if (!mongoDb) return;
    const cutoff = Date.now() - FILES_RETENTION_MS;
    try {
      const result = await mongoDb.collection('messages').updateMany(
        {
          type: { $in: ['file', 'folder', 'voice'] },
          timestamp: { $lt: cutoff },
          payload: { $exists: true, $ne: null }
        },
        { $set: { payload: null, text: '[FILE_EXPIRED: Payload auto-cleaned after 10 days]' } }
      );
      if (result.modifiedCount > 0) {
        console.log(`Cleaned expired file payloads: ${result.modifiedCount} messages`);
      }
    } catch (err) {
      console.error("File cleanup error:", err);
    }
  }

  // Run file cleanup on startup and every hour
  cleanExpiredFilePayloads();
  setInterval(cleanExpiredFilePayloads, 60 * 60 * 1000);

  // Database Accessors
  async function getRooms(): Promise<ChatRoom[]> {
    if (!mongoDb) return [];
    try {
      const rooms = await mongoDb.collection('rooms').find().toArray();
      return rooms.map(r => ({
        id: r.id,
        name: r.name,
        created: r.created || Date.now(),
        active: r.active !== false
      }));
    } catch (err) {
      console.error("Read rooms failed on MongoDB.", err);
      return [];
    }
  }

  async function addRoom(room: ChatRoom): Promise<void> {
    if (!mongoDb) throw new Error("Database not connected");
    await mongoDb.collection('rooms').insertOne(room);
  }

  async function removeRoom(roomId: string): Promise<void> {
    if (!mongoDb) return;
    await mongoDb.collection('rooms').deleteOne({ id: roomId });
    await mongoDb.collection('messages').deleteMany({ roomId });
  }

  async function getRegisteredUsers(): Promise<string[]> {
    if (!mongoDb) return [];
    try {
      const list = await mongoDb.collection('registered_users').find().toArray();
      return list.map(u => u.username);
    } catch (err) {
      console.error(err);
      return [];
    }
  }

  async function registerUser(username: string, codename?: string, passcode?: string): Promise<void> {
    if (!mongoDb) return;
    const sanitized = String(username).trim();
    if (!sanitized) return;
    const userRecord = { username: sanitized, codename: codename || sanitized, passcode: passcode || '0000', created: Date.now() };
    try {
      const exists = await mongoDb.collection('registered_users').findOne({ username: sanitized });
      if (!exists) {
        await mongoDb.collection('registered_users').insertOne(userRecord);
      }
    } catch (err) {
      console.error(err);
    }
  }

  async function getUserNodeInfo(username: string): Promise<{ codename: string; passcode: string; username: string; created: number } | null> {
    if (!mongoDb) return null;
    const sanitized = String(username).trim();
    if (!sanitized) return null;
    try {
      const user = await mongoDb.collection('registered_users').findOne({ username: sanitized });
      if (user) return { codename: user.codename || sanitized, passcode: user.passcode || '0000', username: user.username, created: user.created || Date.now() };
    } catch (err) { console.error(err); }
    return null;
  }

  async function deleteUser(username: string): Promise<void> {
    if (!mongoDb) return;
    await mongoDb.collection('registered_users').deleteOne({ username });
  }

  async function getBlockedUsers(): Promise<string[]> {
    if (!mongoDb) return [];
    try {
      const list = await mongoDb.collection('blocked_users').find().toArray();
      return list.map(u => u.username);
    } catch (err) {
      console.error(err);
      return [];
    }
  }

  async function blockUser(username: string, block: boolean): Promise<void> {
    if (!mongoDb) return;
    if (block) {
      const exists = await mongoDb.collection('blocked_users').findOne({ username });
      if (!exists) {
        await mongoDb.collection('blocked_users').insertOne({ username, timestamp: Date.now() });
      }
    } else {
      await mongoDb.collection('blocked_users').deleteOne({ username });
    }
  }

  // Get messages with cache support
  async function getMessages(roomId: string, sinceId?: string): Promise<ChatMessage[]> {
    if (!mongoDb) return [];

    // Check cache first for full reads
    if (!sinceId) {
      const cached = messageCache.get(roomId);
      if (cached && (Date.now() - cached.lastFetched) < 5000) {
        return cached.messages;
      }
    }

    try {
      const query: any = { roomId };
      if (sinceId) {
        const sinceMsg = await mongoDb.collection('messages').findOne({ id: sinceId });
        if (sinceMsg) {
          query.timestamp = { $gt: sinceMsg.timestamp };
        }
      }
      const msgs = await mongoDb.collection('messages')
        .find(query)
        .sort({ timestamp: 1 })
        .limit(500)
        .toArray();
      const mapped = msgs.map(m => ({
        id: m.id,
        roomId: m.roomId,
        sender: m.sender,
        text: m.text,
        type: m.type as any,
        timestamp: m.timestamp,
        payload: m.payload,
        fileName: m.fileName,
        fileSize: m.fileSize,
        filePath: m.filePath,
        sessionId: m.sessionId
      }));

      // Update cache for full reads
      if (!sinceId) {
        messageCache.set(roomId, { messages: mapped.slice(-CACHE_MAX_MESSAGES), lastFetched: Date.now() });
      }

      return mapped;
    } catch (err) {
      console.error("Read messages failed on MongoDB.", err);
      return [];
    }
  }

  async function addMessage(msg: ChatMessage): Promise<void> {
    if (!mongoDb) throw new Error("Database not connected");

    // Tag message with active session if one exists
    if (!msg.sessionId) {
      const activeSession = await getActiveSession(msg.roomId);
      if (activeSession) {
        msg.sessionId = activeSession.id;
      }
    }

    await mongoDb.collection('messages').insertOne(msg);
    updateMessageCache(msg.roomId, msg);

    // Update session message count
    if (msg.sessionId) {
      await mongoDb.collection('sessions').updateOne(
        { id: msg.sessionId },
        { $inc: { messageCount: 1 } }
      );
    }
  }

  async function getTotalMessageCount(): Promise<number> {
    if (!mongoDb) return 0;
    try {
      return await mongoDb.collection('messages').countDocuments();
    } catch {
      return 0;
    }
  }

  async function resetAllChats(): Promise<void> {
    if (!mongoDb) return;
    await mongoDb.collection('messages').deleteMany({});
    await mongoDb.collection('rooms').deleteMany({});
    await mongoDb.collection('sessions').deleteMany({});
    await mongoDb.collection('rooms').insertOne({
      id: 'general-shell',
      name: 'SECURE_GENERAL_SHELL',
      created: Date.now(),
      active: true
    });
    await mongoDb.collection('messages').insertOne({
      id: 'init-msg-reset',
      roomId: 'general-shell',
      sender: 'SYSTEM_DAEMON',
      text: 'Admin reset triggered. All historical logs deleted. New SECURE terminal session configured.',
      type: 'text',
      timestamp: Date.now()
    });
    messageCache.clear();
  }

  // --- Session Management ---
  async function createSession(name: string, createdBy: string, roomId: string): Promise<ChatSession> {
    if (!mongoDb) throw new Error("Database not connected");

    // Close any existing active session for this room
    await mongoDb.collection('sessions').updateMany(
      { roomId, active: true },
      { $set: { active: false, closedAt: Date.now() } }
    );

    const session: ChatSession = {
      id: `session-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
      name: name.trim() || `Session ${new Date().toLocaleString()}`,
      createdBy,
      createdAt: Date.now(),
      active: true,
      roomId,
      messageCount: 0
    };

    await mongoDb.collection('sessions').insertOne(session);
    bustMessageCache(roomId);

    const systemMsg: ChatMessage = {
      id: `sys-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
      roomId,
      sender: 'SYSTEM_DAEMON',
      text: `New session started: "${session.name}" by admin [${createdBy}].`,
      type: 'text',
      timestamp: Date.now(),
      sessionId: session.id
    };
    await addMessage(systemMsg);
    io.to(roomId).emit('message', systemMsg);
    io.to(roomId).emit('sessionStarted', session);

    return session;
  }

  async function closeSession(sessionId: string): Promise<ChatSession | null> {
    if (!mongoDb) return null;
    const session = await mongoDb.collection('sessions').findOne({ id: sessionId });
    if (!session) return null;

    await mongoDb.collection('sessions').updateOne(
      { id: sessionId },
      { $set: { active: false, closedAt: Date.now() } }
    );

    const closed: ChatSession = {
      id: session.id,
      name: session.name,
      createdBy: session.createdBy,
      createdAt: session.createdAt,
      closedAt: Date.now(),
      active: false,
      roomId: session.roomId,
      messageCount: session.messageCount || 0
    };

    const systemMsg: ChatMessage = {
      id: `sys-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
      roomId: closed.roomId,
      sender: 'SYSTEM_DAEMON',
      text: `Session ended: "${closed.name}". ${closed.messageCount} messages logged.`,
      type: 'text',
      timestamp: Date.now()
    };
    await addMessage(systemMsg);
    io.to(closed.roomId).emit('message', systemMsg);
    io.to(closed.roomId).emit('sessionEnded', closed);

    bustMessageCache(closed.roomId);
    return closed;
  }

  async function getSessions(roomId?: string, limit = 50): Promise<ChatSession[]> {
    if (!mongoDb) return [];
    const query: any = {};
    if (roomId) query.roomId = roomId;
    const sessions = await mongoDb.collection('sessions')
      .find(query)
      .sort({ createdAt: -1 })
      .limit(limit)
      .toArray();
    return sessions.map(s => ({
      id: s.id,
      name: s.name,
      createdBy: s.createdBy,
      createdAt: s.createdAt,
      closedAt: s.closedAt,
      active: s.active,
      roomId: s.roomId,
      messageCount: s.messageCount || 0
    }));
  }

  function idSanitize(id: string): string {
    return id.replace(/[^a-zA-Z0-9_-]/g, '');
  }

  // Socket.io Connection & Activity State
  const activeSockets = new Map<string, { username: string; roomId: string; isTyping: boolean; connectedAt: number }>();

  function broadcastActiveUsers() {
    const users: Array<{ username: string; connectedAt: number }> = [];
    const seen = new Set<string>();
    activeSockets.forEach((state) => {
      if (!seen.has(state.username)) {
        seen.add(state.username);
        users.push({ username: state.username, connectedAt: state.connectedAt });
      }
    });
    io.emit('activeUsers', users);
  }

  io.on('connection', (socket) => {
    console.log(`Socket client joined terminal network: ${socket.id}`);

    socket.on('joinRoom', async ({ username, roomId, codename, passcode }) => {
      const sanitizedRoomId = idSanitize(roomId);
      const sanitizedUsername = String(username).trim();
      const sanitizedCodename = codename ? String(codename).trim() : sanitizedUsername;

      const blockedList = await getBlockedUsers();
      if (blockedList.includes(sanitizedUsername)) {
        socket.emit('userBlockedState', { isBlocked: true, username: sanitizedUsername });
        return;
      }

      await registerUser(sanitizedUsername, sanitizedCodename, passcode);

      socket.join(sanitizedRoomId);
      activeSockets.set(socket.id, {
        username: sanitizedUsername,
        roomId: sanitizedRoomId,
        isTyping: false,
        connectedAt: Date.now()
      });

      console.log(`User [${sanitizedUsername}] joined terminal terminal room: ${sanitizedRoomId}`);

      // Broadcast entry system log to chamber
      const systemJoinMsg: ChatMessage = {
        id: `sys-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
        roomId: sanitizedRoomId,
        sender: 'SYSTEM_DAEMON',
        text: `User [${sanitizedUsername}] connected to stream interface.`,
        type: 'text',
        timestamp: Date.now()
      };
      
      // Save logs if we want them saved, otherwise just broadcast
      await addMessage(systemJoinMsg);
      io.to(sanitizedRoomId).emit('message', systemJoinMsg);

      // Send recent chat history to the joining user
      const recentMessages = await getMessages(sanitizedRoomId);
      socket.emit('chatHistory', recentMessages);

      // Emit updated lists
      sendRoomTypingStatus(sanitizedRoomId);
      broadcastActiveUsers();
    });

    socket.on('sendMessage', async (msgData: { roomId: string; sender: string; text: string; type: any; payload?: string; fileName?: string; fileSize?: number; filePath?: string }) => {
      const sanitizedRoomId = idSanitize(msgData.roomId);
      const sender = String(msgData.sender || 'UNKNOWN_NODE').trim();
      
      const blockedList = await getBlockedUsers();
      if (blockedList.includes(sender)) {
        socket.emit('userBlockedState', { isBlocked: true, username: sender });
        return;
      }

      const newMsg: ChatMessage = {
        id: `msg-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
        roomId: sanitizedRoomId,
        sender,
        text: String(msgData.text || ''),
        type: msgData.type || 'text',
        timestamp: Date.now(),
        payload: msgData.payload,
        fileName: msgData.fileName,
        fileSize: msgData.fileSize,
        filePath: msgData.filePath
      };

      await addMessage(newMsg);
      io.to(sanitizedRoomId).emit('message', newMsg);
      
      // Reset typing status on message dispatch
      const state = activeSockets.get(socket.id);
      if (state) {
        state.isTyping = false;
        sendRoomTypingStatus(sanitizedRoomId);
      }
    });

    // Private 1-to-1 messaging
    socket.on('joinPrivateRoom', ({ targetUsername }) => {
      const senderState = activeSockets.get(socket.id);
      if (!senderState) return;
      const participants = [senderState.username, targetUsername].sort();
      const privateRoomId = `private:${participants[0]}:${participants[1]}`;
      socket.join(privateRoomId);

      // Also add the target's sockets to this private room if connected
      activeSockets.forEach((state, sid) => {
        if (state.username === targetUsername) {
          const targetSocket = io.sockets.sockets.get(sid);
          if (targetSocket) {
            targetSocket.join(privateRoomId);
            targetSocket.emit('privateRoomJoined', { roomId: privateRoomId, from: senderState.username });
          }
        }
      });
    });

    socket.on('privateMessage', async ({ to, text, type, payload, fileName, fileSize }) => {
      const senderState = activeSockets.get(socket.id);
      if (!senderState) return;
      const sender = senderState.username;
      const blockedList = await getBlockedUsers();
      if (blockedList.includes(sender)) {
        socket.emit('userBlockedState', { isBlocked: true, username: sender });
        return;
      }

      const participants = [sender, to].sort();
      const privateRoomId = `private:${participants[0]}:${participants[1]}`;

      const newMsg: ChatMessage = {
        id: `msg-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
        roomId: privateRoomId,
        sender,
        text: String(text || ''),
        type: type || 'text',
        timestamp: Date.now(),
        payload,
        fileName,
        fileSize
      };

      await addMessage(newMsg);
      socket.emit('message', newMsg);

      activeSockets.forEach((state, sid) => {
        if (state.username === to) {
          const targetSocket = io.sockets.sockets.get(sid);
          if (targetSocket) {
            targetSocket.emit('message', newMsg);
            targetSocket.join(privateRoomId);
          }
        }
      });
    });

    socket.on('typing', async ({ isTyping }) => {
      const state = activeSockets.get(socket.id);
      if (state) {
        const blockedList = await getBlockedUsers();
        if (blockedList.includes(state.username)) {
          return;
        }
        state.isTyping = !!isTyping;
        sendRoomTypingStatus(state.roomId);
      }
    });

    socket.on('disconnect', async () => {
      const state = activeSockets.get(socket.id);
      if (state) {
        const { username, roomId } = state;
        activeSockets.delete(socket.id);
        console.log(`User [${username}] exited terminal network`);

        // Log exit alert
        const systemExitMsg: ChatMessage = {
          id: `sys-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
          roomId,
          sender: 'SYSTEM_DAEMON',
          text: `User [${username}] disconnected from terminal stream interface.`,
          type: 'text',
          timestamp: Date.now()
        };
        await addMessage(systemExitMsg);
        io.to(roomId).emit('message', systemExitMsg);

        sendRoomTypingStatus(roomId);
        broadcastActiveUsers();
      }
    });
  });

  // Helper to compile and announce typing users for a single room
  function sendRoomTypingStatus(roomId: string) {
    const typingUsers: string[] = [];
    activeSockets.forEach((client) => {
      if (client.roomId === roomId && client.isTyping) {
        typingUsers.push(client.username);
      }
    });
    io.to(roomId).emit('typingUpdate', typingUsers);
  }

  // --- REST ENDPOINTS ---

  app.get('/api/rooms', async (req, res) => {
    try {
      const chambers = await getRooms();
      res.set('Cache-Control', 'no-cache, must-revalidate');
      res.json(chambers);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/rooms', express.json(), async (req, res) => {
    try {
      const { name } = req.body;
      if (!name || String(name).trim() === '') {
        return res.status(400).json({ error: 'Chamber identifier cannot be empty' });
      }
      const rawName = String(name).trim().toUpperCase().replace(/[^A-Z0-9_]/g, '_');
      const id = rawName.toLowerCase().replace(/_/g, '-');
      
      const rooms = await getRooms();
      if (rooms.some(r => r.id === id)) {
        return res.status(400).json({ error: 'Chamber already initialized' });
      }

      const newRoom: ChatRoom = {
        id,
        name: `SECURE_${rawName}`,
        created: Date.now(),
        active: true
      };

      await addRoom(newRoom);
      
      const createAlert: ChatMessage = {
        id: `sys-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
        roomId: id,
        sender: 'SYSTEM_DAEMON',
        text: `Secure communication chamber is initialized. Encryption levels: STATIC_AES.`,
        type: 'text',
        timestamp: Date.now()
      };
      await addMessage(createAlert);
      io.emit('roomCreated', newRoom);
      res.json(newRoom);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/api/messages', async (req, res) => {
    try {
      const { roomId, since, limit } = req.query;
      if (!roomId) {
        return res.status(400).json({ error: 'Missing chamber parameters' });
      }
      const messages = await getMessages(String(roomId), since ? String(since) : undefined);
      const limited = limit ? messages.slice(-Number(limit)) : messages;
      
      const etag = crypto.createHash('md5').update(JSON.stringify(limited.map(m => m.id + m.timestamp))).digest('hex');
      res.set('Cache-Control', 'no-cache, must-revalidate');
      res.set('ETag', etag);
      
      if (req.headers['if-none-match'] === etag) {
        return res.status(304).end();
      }
      
      res.json(limited);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/messages', express.json({ limit: '10mb' }), async (req, res) => {
    try {
      const { roomId, sender, text, type, payload, fileName, fileSize, filePath, sessionId } = req.body;
      if (!roomId || !sender) {
        return res.status(400).json({ error: 'Missing required fields: roomId, sender' });
      }
      const sanitizedRoomId = idSanitize(roomId);
      const newMsg: ChatMessage = {
        id: `msg-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
        roomId: sanitizedRoomId,
        sender: String(sender).trim(),
        text: String(text || ''),
        type: type || 'text',
        timestamp: Date.now(),
        payload, fileName, fileSize, filePath, sessionId
      };
      await addMessage(newMsg);
      io.to(sanitizedRoomId).emit('message', newMsg);
      res.json(newMsg);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/upload-files', express.json({ limit: '100mb' }), async (req, res) => {
    try {
      const { roomId, sender, files, sessionId } = req.body;
      if (!roomId || !sender || !files || !Array.isArray(files) || files.length === 0) {
        return res.status(400).json({ error: 'Invalid payload files structure' });
      }

      const sanitizedRoomId = idSanitize(roomId);

      if (files.length === 1 && !files[0].path) {
        const file = files[0];
        const newMsg: ChatMessage = {
          id: `msg-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
          roomId: sanitizedRoomId,
          sender: String(sender),
          text: `Uploaded File: ${file.name} (${(file.size / 1024).toFixed(1)} KB)`,
          type: 'file',
          timestamp: Date.now(),
          payload: file.base64,
          fileName: file.name,
          fileSize: file.size,
          sessionId
        };
        await addMessage(newMsg);
        io.to(sanitizedRoomId).emit('message', newMsg);
      } else {
        const totalSize = files.reduce((acc, f) => acc + (f.size || 0), 0);
        const folderName = files[0].path ? files[0].path.split('/')[0] : 'UPLOADED_FOLDER';
        
        const folderMetadata = files.map(f => ({
          name: f.name, size: f.size, path: f.path, base64: f.base64
        }));

        const newMsg: ChatMessage = {
          id: `msg-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
          roomId: sanitizedRoomId,
          sender: String(sender),
          text: `Uploaded Directory Workspace: [${folderName}/] comprising ${files.length} node structures (${(totalSize / 1024).toFixed(1)} KB)`,
          type: 'folder',
          timestamp: Date.now(),
          payload: JSON.stringify(folderMetadata),
          fileName: folderName,
          fileSize: totalSize,
          sessionId
        };
        await addMessage(newMsg);
        io.to(sanitizedRoomId).emit('message', newMsg);
      }

      res.json({ success: true });
    } catch (e: any) {
      console.error(e);
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/api/users/:username/info', async (req, res) => {
    try {
      const info = await getUserNodeInfo(req.params.username);
      if (!info) return res.status(404).json({ error: 'Node not found' });
      res.json(info);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/api/active-users', async (req, res) => {
    const users: Array<{ username: string; connectedAt: number }> = [];
    const seen = new Set<string>();
    activeSockets.forEach((state) => {
      if (!seen.has(state.username)) {
        seen.add(state.username);
        users.push({ username: state.username, connectedAt: state.connectedAt });
      }
    });
    res.json(users);
  });

  app.get('/api/admin/users', async (req, res) => {
    try {
      const reg = await getRegisteredUsers();
      const blocked = await getBlockedUsers();
      const active: string[] = [];
      activeSockets.forEach((client) => {
        if (!active.includes(client.username)) {
          active.push(client.username);
        }
      });
      res.json({ registered: reg, active, blocked });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/admin/users/block', express.json(), async (req, res) => {
    try {
      const { username, block } = req.body;
      if (!username) {
        return res.status(400).json({ error: 'Missing username parameter' });
      }
      const sUserName = String(username).trim();
      await blockUser(sUserName, !!block);
      io.emit('userModerated', { username: sUserName, action: block ? 'block' : 'unblock' });
      res.json({ success: true, username: sUserName, blocked: !!block });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/admin/users/delete', express.json(), async (req, res) => {
    try {
      const { username } = req.body;
      if (!username) {
        return res.status(400).json({ error: 'Missing username parameter' });
      }
      const sUserName = String(username).trim();
      await deleteUser(sUserName);
      io.emit('userModerated', { username: sUserName, action: 'delete' });
      res.json({ success: true, username: sUserName });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete('/api/admin/rooms/:id', async (req, res) => {
    try {
      const roomId = req.params.id;
      if (!roomId) {
        return res.status(400).json({ error: 'Missing room identifier' });
      }
      await removeRoom(roomId);
      io.emit('roomDeleted', { roomId });
      res.json({ success: true, roomId });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/admin/reset', async (req, res) => {
    try {
      const { passcode } = req.body;
      if (passcode !== '0000') {
        return res.status(403).json({ error: 'UNAUTHORIZED: Invalid admin passcode (0000 required)' });
      }
      console.log("ALERT: Admin requested full clearance.");
      await resetAllChats();
      io.emit('databaseWiped', { restart: true });
      res.json({ success: true, message: "LOGS_WIPED_SUCCESSFULLY" });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // --- Session Management Endpoints ---
  app.get('/api/admin/sessions', async (req, res) => {
    try {
      const { roomId } = req.query;
      const sessions = await getSessions(roomId ? String(roomId) : undefined);
      const totalMessages = await getTotalMessageCount();
      res.json({ sessions, totalMessages });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/admin/sessions', express.json(), async (req, res) => {
    try {
      const { name, roomId, adminName } = req.body;
      if (!name || !roomId || !adminName) {
        return res.status(400).json({ error: 'Missing required fields: name, roomId, adminName' });
      }
      const session = await createSession(name, adminName, roomId);
      io.emit('sessionStarted', session);
      res.json(session);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/admin/sessions/:id/close', async (req, res) => {
    try {
      const closed = await closeSession(req.params.id);
      if (!closed) return res.status(404).json({ error: 'Session not found' });
      res.json(closed);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/api/admin/stats', async (req, res) => {
    try {
      const totalMessages = await getTotalMessageCount();
      const totalUsers = (await getRegisteredUsers()).length;
      const totalSessions = (await getSessions()).length;
      res.json({ totalMessages, totalUsers, totalSessions, dbMode: 'MongoDB Atlas' });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // --- STATIC AND VITE SERVER BINDING ---
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        watch: {
          ignored: ['**/data_vault.json'],
        },
      },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath, {
      maxAge: '1y',
      immutable: true,
      setHeaders: (res, filePath) => {
        if (filePath.endsWith('.html')) {
          res.setHeader('Cache-Control', 'no-cache, must-revalidate');
        } else if (filePath.endsWith('.js') || filePath.endsWith('.css')) {
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        }
      }
    }));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`[DAEMON STATUS]: Secured monochromatic terminal session listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((e) => {
  console.error("FATAL: Terminal server failed to initialize", e);
});

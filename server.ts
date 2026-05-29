/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import express from 'express';
import http from 'http';
import { Server as SocketServer } from 'socket.io';
import { MongoClient, Db } from 'mongodb';
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import { createServer as createViteServer } from 'vite';
import { ChatMessage, ChatRoom } from './src/types';

dotenv.config();

async function startServer() {
  const app = express();
  const PORT = 3000;
  const server = http.createServer(app);

  const io = new SocketServer(server, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST']
    },
    maxHttpBufferSize: 1e8 // 100MB limit for secure binary payloads
  });

  // Parse payload limits up to 100MB for secure binary-base64 assets (voice, folders, files)
  app.use(express.json({ limit: '100mb' }));
  app.use(express.urlencoded({ limit: '100mb', extended: true }));

  // Dynamic MongoDB Atlas Setup
  let mongoClient: MongoClient | null = null;
  let mongoDb: Db | null = null;

  const mongoUriStr = process.env.MONGODB_URI || '';
  const isMongoConfigured = mongoUriStr && !mongoUriStr.includes('<username>') && mongoUriStr.trim() !== '';

  const LOCAL_VAULT_PATH = path.join(process.cwd(), 'data_vault.json');

  // Load and fallback safely with JSON
  function loadLocalVault() {
    if (!fs.existsSync(LOCAL_VAULT_PATH)) {
      const initial = {
        rooms: [
          { id: 'general-shell', name: 'SECURE_GENERAL_SHELL', created: Date.now(), active: true },
          { id: 'netsec-comms', name: 'NETSEC_OPERATIONAL_COMMS', created: Date.now(), active: true }
        ],
        messages: [
          {
            id: 'init-msg-1',
            roomId: 'general-shell',
            sender: 'SYSTEM_DAEMON',
            text: 'Terminal initialized. Protocol secure. Monochromatic chat room is operational.',
            type: 'text',
            timestamp: Date.now()
          }
        ],
        registeredUsers: [],
        blockedUsers: []
      };
      fs.writeFileSync(LOCAL_VAULT_PATH, JSON.stringify(initial, null, 2));
      return initial;
    }
    try {
      const data = JSON.parse(fs.readFileSync(LOCAL_VAULT_PATH, 'utf-8'));
      if (!data.registeredUsers) data.registeredUsers = [];
      if (!data.blockedUsers) data.blockedUsers = [];
      return data;
    } catch (e) {
      console.error("Local vault parse failure, rebuilding vault storage.", e);
      return { rooms: [], messages: [], registeredUsers: [], blockedUsers: [] };
    }
  }

  function saveLocalVault(data: any) {
    try {
      fs.writeFileSync(LOCAL_VAULT_PATH, JSON.stringify(data, null, 2));
    } catch (err) {
      console.error("Failed to write state into local vault file", err);
    }
  }

  // Database initialization
  if (isMongoConfigured) {
    try {
      console.log("Initializing secure connection to MongoDB Atlas cluster...");
      mongoClient = new MongoClient(mongoUriStr, {
        serverSelectionTimeoutMS: 10000,
        connectTimeoutMS: 10000,
      });
      await mongoClient.connect();
      mongoDb = mongoClient.db('terminal_chat');
      console.log("MongoDB Atlas cluster linked successfully.");

      // Check if rooms are populated, if not, bootstrap default chambers
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
      console.error("CRITICAL: MongoDB Atlas connection failed. Falling back to secure local data vault.", e);
      mongoClient = null;
      mongoDb = null;
      loadLocalVault();
    }
  } else {
    console.log("MongoDB Atlas URI not configured or using placeholder. Activating local secure json-vault mode.");
    loadLocalVault();
  }

  // Database Accessors with fallback capability
  async function getRooms(): Promise<ChatRoom[]> {
    if (mongoDb) {
      try {
        const rooms = await mongoDb.collection('rooms').find().toArray();
        return rooms.map(r => ({
          id: r.id,
          name: r.name,
          created: r.created || Date.now(),
          active: r.active !== false
        }));
      } catch (err) {
        console.error("Read rooms failed on MongoDB. Falling back onto JSON store.", err);
      }
    }
    return loadLocalVault().rooms;
  }

  async function addRoom(room: ChatRoom): Promise<void> {
    if (mongoDb) {
      try {
        await mongoDb.collection('rooms').insertOne(room);
        return;
      } catch (err) {
        console.error("Insert room failed on MongoDB. Falling back onto JSON store.", err);
      }
    }
    const vault = loadLocalVault();
    vault.rooms.push(room);
    saveLocalVault(vault);
  }

  async function removeRoom(roomId: string): Promise<void> {
    if (mongoDb) {
      try {
        await mongoDb.collection('rooms').deleteOne({ id: roomId });
        await mongoDb.collection('messages').deleteMany({ roomId });
        return;
      } catch (err) {
        console.error(err);
      }
    }
    const vault = loadLocalVault();
    vault.rooms = vault.rooms.filter((r: any) => r.id !== roomId);
    vault.messages = vault.messages.filter((m: any) => m.roomId !== roomId);
    saveLocalVault(vault);
  }

  async function getRegisteredUsers(): Promise<string[]> {
    if (mongoDb) {
      try {
        const list = await mongoDb.collection('registered_users').find().toArray();
        return list.map(u => u.username);
      } catch (err) {
        console.error(err);
      }
    }
    return loadLocalVault().registeredUsers || [];
  }

  async function registerUser(username: string, codename?: string, passcode?: string): Promise<void> {
    const sanitized = String(username).trim();
    if (!sanitized) return;
    const userRecord = { username: sanitized, codename: codename || sanitized, passcode: passcode || '0000', created: Date.now() };
    if (mongoDb) {
      try {
        const exists = await mongoDb.collection('registered_users').findOne({ username: sanitized });
        if (!exists) {
          await mongoDb.collection('registered_users').insertOne(userRecord);
        }
        return;
      } catch (err) {
        console.error(err);
      }
    }
    const vault = loadLocalVault();
    if (!vault.registeredUsers) vault.registeredUsers = [];
    const existing = vault.registeredUsers.find((u: any) => (typeof u === 'string' ? u : u.username) === sanitized);
    if (!existing) {
      vault.registeredUsers.push(userRecord);
      saveLocalVault(vault);
    }
  }

  async function getUserNodeInfo(username: string): Promise<{ codename: string; passcode: string; username: string; created: number } | null> {
    const sanitized = String(username).trim();
    if (!sanitized) return null;
    if (mongoDb) {
      try {
        const user = await mongoDb.collection('registered_users').findOne({ username: sanitized });
        if (user) return { codename: user.codename || sanitized, passcode: user.passcode || '0000', username: user.username, created: user.created || Date.now() };
      } catch (err) { console.error(err); }
    }
    const vault = loadLocalVault();
    const user = vault.registeredUsers.find((u: any) => (typeof u === 'string' ? u : u.username) === sanitized);
    if (!user) return null;
    if (typeof user === 'string') return { codename: user, passcode: '0000', username: user, created: Date.now() };
    return { codename: user.codename || user.username, passcode: user.passcode || '0000', username: user.username, created: user.created || Date.now() };
  }

  async function deleteUser(username: string): Promise<void> {
    if (mongoDb) {
      try {
        await mongoDb.collection('registered_users').deleteOne({ username });
        return;
      } catch (err) {
        console.error(err);
      }
    }
    const vault = loadLocalVault();
    vault.registeredUsers = (vault.registeredUsers || []).filter((u: string) => u !== username);
    saveLocalVault(vault);
  }

  async function getBlockedUsers(): Promise<string[]> {
    if (mongoDb) {
      try {
        const list = await mongoDb.collection('blocked_users').find().toArray();
        return list.map(u => u.username);
      } catch (err) {
        console.error(err);
      }
    }
    return loadLocalVault().blockedUsers || [];
  }

  async function blockUser(username: string, block: boolean): Promise<void> {
    if (mongoDb) {
      try {
        if (block) {
          const exists = await mongoDb.collection('blocked_users').findOne({ username });
          if (!exists) {
            await mongoDb.collection('blocked_users').insertOne({ username, timestamp: Date.now() });
          }
        } else {
          await mongoDb.collection('blocked_users').deleteOne({ username });
        }
        return;
      } catch (err) {
        console.error(err);
      }
    }
    const vault = loadLocalVault();
    if (!vault.blockedUsers) vault.blockedUsers = [];
    if (block) {
      if (!vault.blockedUsers.includes(username)) {
        vault.blockedUsers.push(username);
      }
    } else {
      vault.blockedUsers = vault.blockedUsers.filter((u: string) => u !== username);
    }
    saveLocalVault(vault);
  }

  async function getMessages(roomId: string): Promise<ChatMessage[]> {
    if (mongoDb) {
      try {
        const msgs = await mongoDb.collection('messages')
          .find({ roomId })
          .sort({ timestamp: 1 })
          .toArray();
        return msgs.map(m => ({
          id: m.id,
          roomId: m.roomId,
          sender: m.sender,
          text: m.text,
          type: m.type as any,
          timestamp: m.timestamp,
          payload: m.payload,
          fileName: m.fileName,
          fileSize: m.fileSize,
          filePath: m.filePath
        }));
      } catch (err) {
        console.error("Read messages failed on MongoDB. Falling back onto JSON store.", err);
      }
    }
    const vault = loadLocalVault();
    return vault.messages.filter((m: any) => m.roomId === idSanitize(roomId));
  }

  async function addMessage(msg: ChatMessage): Promise<void> {
    if (mongoDb) {
      try {
        await mongoDb.collection('messages').insertOne(msg);
        return;
      } catch (err) {
        console.error("Insert message failed on MongoDB. Falling back onto JSON store.", err);
      }
    }
    const vault = loadLocalVault();
    vault.messages.push(msg);
    saveLocalVault(vault);
  }

  async function resetAllChats(): Promise<void> {
    if (mongoDb) {
      try {
        await mongoDb.collection('messages').deleteMany({});
        await mongoDb.collection('rooms').deleteMany({});
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
        return;
      } catch (err) {
        console.error("Delete database trigger failed on MongoDB. Falling back onto JSON store.", err);
      }
    }
    const vault = {
      rooms: [
        { id: 'general-shell', name: 'SECURE_GENERAL_SHELL', created: Date.now(), active: true }
      ],
      messages: [
        {
          id: 'init-msg-reset',
          roomId: 'general-shell',
          sender: 'SYSTEM_DAEMON',
          text: 'Admin reset triggered. All historical logs deleted. New SECURE terminal session configured.',
          type: 'text',
          timestamp: Date.now()
        }
      ]
    };
    saveLocalVault(vault);
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

  // --- REST ENDPOINTS (JSON Interface for failsafe synchronization & payload storage) ---

  // GET Chambers listed
  app.get('/api/rooms', async (req, res) => {
    try {
      const chambers = await getRooms();
      res.json(chambers);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // POST create chamber
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
      
      // Inject alert
      const createAlert: ChatMessage = {
        id: `sys-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
        roomId: id,
        sender: 'SYSTEM_DAEMON',
        text: `Secure communication chamber is initialized. Encryption levels: STATIC_AES.`,
        type: 'text',
        timestamp: Date.now()
      };
      await addMessage(createAlert);

      // Broadcast globally
      io.emit('roomCreated', newRoom);

      res.json(newRoom);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // GET messages for room (Failsafe Sync endpoint called every 3 seconds by client)
  app.get('/api/messages', async (req, res) => {
    try {
      const { roomId } = req.query;
      if (!roomId) {
        return res.status(400).json({ error: 'Missing chamber parameters' });
      }
      const messages = await getMessages(String(roomId));
      res.json(messages);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // POST send message via HTTP (fallback when WebSocket unavailable, e.g. Vercel serverless)
  app.post('/api/messages', express.json({ limit: '10mb' }), async (req, res) => {
    try {
      const { roomId, sender, text, type, payload, fileName, fileSize, filePath } = req.body;
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
        payload, fileName, fileSize, filePath
      };
      await addMessage(newMsg);
      io.to(sanitizedRoomId).emit('message', newMsg);
      res.json(newMsg);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // POST upload files/folders via body Base64
  app.post('/api/upload-files', express.json({ limit: '100mb' }), async (req, res) => {
    try {
      const { roomId, sender, files } = req.body;
      if (!roomId || !sender || !files || !Array.isArray(files) || files.length === 0) {
        return res.status(400).json({ error: 'Invalid payload files structure' });
      }

      const sanitizedRoomId = idSanitize(roomId);

      if (files.length === 1 && !files[0].path) {
        // Single File Upload
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
          fileSize: file.size
        };
        await addMessage(newMsg);
        io.to(sanitizedRoomId).emit('message', newMsg);
      } else {
        // Folder Upload
        // We pack all file structural details into 'payload' as stringified JSON detail containing files base64 block
        const totalSize = files.reduce((acc, f) => acc + (f.size || 0), 0);
        const folderName = files[0].path ? files[0].path.split('/')[0] : 'UPLOADED_FOLDER';
        
        const folderMetadata = files.map(f => ({
          name: f.name,
          size: f.size,
          path: f.path,
          base64: f.base64
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
          fileSize: totalSize
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

  // GET User Node Info (codename, passcode)
  app.get('/api/users/:username/info', async (req, res) => {
    try {
      const info = await getUserNodeInfo(req.params.username);
      if (!info) return res.status(404).json({ error: 'Node not found' });
      res.json(info);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // GET Active connected users
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

  // GET Registered, Active, and Blocked Users List
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
      res.json({
        registered: reg,
        active,
        blocked
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST Block/Suspend User Node
  app.post('/api/admin/users/block', express.json(), async (req, res) => {
    try {
      const { username, block } = req.body;
      if (!username) {
        return res.status(400).json({ error: 'Missing username parameter' });
      }
      const sUserName = String(username).trim();
      await blockUser(sUserName, !!block);

      // notify socket net
      io.emit('userModerated', { username: sUserName, action: block ? 'block' : 'unblock' });
      res.json({ success: true, username: sUserName, blocked: !!block });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST Delete/Deregister User Operator Node
  app.post('/api/admin/users/delete', express.json(), async (req, res) => {
    try {
      const { username } = req.body;
      if (!username) {
        return res.status(400).json({ error: 'Missing username parameter' });
      }
      const sUserName = String(username).trim();
      await deleteUser(sUserName);

      // notify socket net to force logout
      io.emit('userModerated', { username: sUserName, action: 'delete' });
      res.json({ success: true, username: sUserName });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // DELETE Secure Chamber Room channel (Groups chatting feature control)
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

  // POST Admin Wipeout Command
  app.post('/api/admin/reset', async (req, res) => {
    try {
      console.log("ALERT: Admin requested full clearance / starting a clean chat log.");
      await resetAllChats();
      // Announce wipeout event to all clients to force-reload state
      io.emit('databaseWiped', { restart: true });
      res.json({ success: true, message: "LOGS_WIPED_SUCCESSFULLY" });
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
    app.use(express.static(distPath));
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

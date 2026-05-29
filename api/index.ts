import express from 'express';
import { MongoClient, Db } from 'mongodb';
import path from 'path';
import fs from 'fs';

interface ChatMessage {
  id: string;
  roomId: string;
  sender: string;
  text: string;
  type: string;
  timestamp: number;
  payload?: string;
  fileName?: string;
  fileSize?: number;
  filePath?: string;
}

interface ChatRoom {
  id: string;
  name: string;
  created: number;
  active: boolean;
}

const app = express();
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ limit: '100mb', extended: true }));

let mongoClient: MongoClient | null = null;
let mongoDb: Db | null = null;

const mongoUriStr = process.env.MONGODB_URI || '';
const isMongoConfigured = mongoUriStr && !mongoUriStr.includes('<username>') && mongoUriStr.trim() !== '';

const LOCAL_VAULT_PATH = process.env.VERCEL
  ? path.join('/tmp', 'data_vault.json')
  : path.join(process.cwd(), 'data_vault.json');

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

async function initDatabase() {
  if (isMongoConfigured) {
    try {
      mongoClient = new MongoClient(mongoUriStr);
      await mongoClient.connect();
      mongoDb = mongoClient.db('terminal_chat');

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
      }
      console.log("MongoDB Atlas connected.");
    } catch (e) {
      console.error("MongoDB connection failed, using local vault.", e);
      mongoClient = null;
      mongoDb = null;
      loadLocalVault();
    }
  } else {
    console.log("MongoDB not configured. Using local vault.");
    loadLocalVault();
  }
}

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
      console.error(err);
    }
  }
  return loadLocalVault().rooms;
}

async function addRoom(room: ChatRoom): Promise<void> {
  if (mongoDb) {
    try { await mongoDb.collection('rooms').insertOne(room); return; } catch (err) { console.error(err); }
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
    } catch (err) { console.error(err); }
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
    } catch (err) { console.error(err); }
  }
  return loadLocalVault().registeredUsers || [];
}

async function registerUser(username: string): Promise<void> {
  const sanitized = String(username).trim();
  if (!sanitized) return;
  if (mongoDb) {
    try {
      const exists = await mongoDb.collection('registered_users').findOne({ username: sanitized });
      if (!exists) await mongoDb.collection('registered_users').insertOne({ username: sanitized, created: Date.now() });
      return;
    } catch (err) { console.error(err); }
  }
  const vault = loadLocalVault();
  if (!vault.registeredUsers) vault.registeredUsers = [];
  if (!vault.registeredUsers.includes(sanitized)) {
    vault.registeredUsers.push(sanitized);
    saveLocalVault(vault);
  }
}

async function deleteUser(username: string): Promise<void> {
  if (mongoDb) {
    try { await mongoDb.collection('registered_users').deleteOne({ username }); return; } catch (err) { console.error(err); }
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
    } catch (err) { console.error(err); }
  }
  return loadLocalVault().blockedUsers || [];
}

async function blockUser(username: string, block: boolean): Promise<void> {
  if (mongoDb) {
    try {
      if (block) {
        const exists = await mongoDb.collection('blocked_users').findOne({ username });
        if (!exists) await mongoDb.collection('blocked_users').insertOne({ username, timestamp: Date.now() });
      } else {
        await mongoDb.collection('blocked_users').deleteOne({ username });
      }
      return;
    } catch (err) { console.error(err); }
  }
  const vault = loadLocalVault();
  if (!vault.blockedUsers) vault.blockedUsers = [];
  if (block) {
    if (!vault.blockedUsers.includes(username)) vault.blockedUsers.push(username);
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
        id: m.id, roomId: m.roomId, sender: m.sender,
        text: m.text, type: m.type, timestamp: m.timestamp,
        payload: m.payload, fileName: m.fileName, fileSize: m.fileSize, filePath: m.filePath
      }));
    } catch (err) { console.error(err); }
  }
  const vault = loadLocalVault();
  return vault.messages.filter((m: any) => m.roomId === idSanitize(roomId));
}

async function addMessage(msg: ChatMessage): Promise<void> {
  if (mongoDb) {
    try { await mongoDb.collection('messages').insertOne(msg); return; } catch (err) { console.error(err); }
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
      await mongoDb.collection('rooms').insertOne({ id: 'general-shell', name: 'SECURE_GENERAL_SHELL', created: Date.now(), active: true });
      await mongoDb.collection('messages').insertOne({ id: 'init-msg-reset', roomId: 'general-shell', sender: 'SYSTEM_DAEMON', text: 'Admin reset triggered. All logs deleted.', type: 'text', timestamp: Date.now() });
      return;
    } catch (err) { console.error(err); }
  }
  saveLocalVault({
    rooms: [{ id: 'general-shell', name: 'SECURE_GENERAL_SHELL', created: Date.now(), active: true }],
    messages: [{ id: 'init-msg-reset', roomId: 'general-shell', sender: 'SYSTEM_DAEMON', text: 'Admin reset triggered. All logs deleted.', type: 'text', timestamp: Date.now() }]
  });
}

function idSanitize(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, '');
}

// --- REST API Routes ---

app.get('/api/rooms', async (req, res) => {
  try {
    const chambers = await getRooms();
    res.json(chambers);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/rooms', async (req, res) => {
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
    const newRoom: ChatRoom = { id, name: `SECURE_${rawName}`, created: Date.now(), active: true };
    await addRoom(newRoom);
    const createAlert: ChatMessage = {
      id: `sys-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
      roomId: id, sender: 'SYSTEM_DAEMON',
      text: 'Secure communication chamber is initialized. Encryption levels: STATIC_AES.',
      type: 'text', timestamp: Date.now()
    };
    await addMessage(createAlert);
    res.json(newRoom);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/messages', async (req, res) => {
  try {
    const { roomId } = req.query;
    if (!roomId) return res.status(400).json({ error: 'Missing chamber parameters' });
    const messages = await getMessages(String(roomId));
    res.json(messages);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/messages', async (req, res) => {
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
    res.json(newMsg);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/upload-files', async (req, res) => {
  try {
    const { roomId, sender, files } = req.body;
    if (!roomId || !sender || !files || !Array.isArray(files) || files.length === 0) {
      return res.status(400).json({ error: 'Invalid payload files structure' });
    }
    const sanitizedRoomId = idSanitize(roomId);
    if (files.length === 1 && !files[0].path) {
      const file = files[0];
      const newMsg: ChatMessage = {
        id: `msg-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
        roomId: sanitizedRoomId, sender: String(sender),
        text: `Uploaded File: ${file.name} (${(file.size / 1024).toFixed(1)} KB)`,
        type: 'file', timestamp: Date.now(),
        payload: file.base64, fileName: file.name, fileSize: file.size
      };
      await addMessage(newMsg);
    } else {
      const totalSize = files.reduce((acc: number, f: any) => acc + (f.size || 0), 0);
      const folderName = files[0].path ? files[0].path.split('/')[0] : 'UPLOADED_FOLDER';
      const folderMetadata = files.map((f: any) => ({ name: f.name, size: f.size, path: f.path, base64: f.base64 }));
      const newMsg: ChatMessage = {
        id: `msg-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
        roomId: sanitizedRoomId, sender: String(sender),
        text: `Uploaded Directory Workspace: [${folderName}/] comprising ${files.length} node structures (${(totalSize / 1024).toFixed(1)} KB)`,
        type: 'folder', timestamp: Date.now(),
        payload: JSON.stringify(folderMetadata), fileName: folderName, fileSize: totalSize
      };
      await addMessage(newMsg);
    }
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/admin/users', async (req, res) => {
  try {
    const reg = await getRegisteredUsers();
    const blocked = await getBlockedUsers();
    res.json({ registered: reg, active: [], blocked });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/users/block', async (req, res) => {
  try {
    const { username, block } = req.body;
    if (!username) return res.status(400).json({ error: 'Missing username parameter' });
    const sUserName = String(username).trim();
    await blockUser(sUserName, !!block);
    res.json({ success: true, username: sUserName, blocked: !!block });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/users/delete', async (req, res) => {
  try {
    const { username } = req.body;
    if (!username) return res.status(400).json({ error: 'Missing username parameter' });
    const sUserName = String(username).trim();
    await deleteUser(sUserName);
    res.json({ success: true, username: sUserName });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/admin/rooms/:id', async (req, res) => {
  try {
    const roomId = req.params.id;
    if (!roomId) return res.status(400).json({ error: 'Missing room identifier' });
    await removeRoom(roomId);
    res.json({ success: true, roomId });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/reset', async (req, res) => {
  try {
    await resetAllChats();
    res.json({ success: true, message: "LOGS_WIPED_SUCCESSFULLY" });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

const distPath = path.join(process.cwd(), 'dist');
app.use(express.static(distPath));
app.get('*', (req, res) => {
  res.sendFile(path.join(distPath, 'index.html'));
});

let initialized = false;
async function ensureInitialized() {
  if (!initialized) {
    await initDatabase();
    initialized = true;
  }
}

export default async function handler(req: any, res: any) {
  await ensureInitialized();
  app(req, res);
}

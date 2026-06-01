import express from 'express';
import { MongoClient, Db } from 'mongodb';
import path from 'path';

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
  sessionId?: string;
}

interface ChatRoom {
  id: string;
  name: string;
  created: number;
  active: boolean;
}

interface ChatSession {
  id: string;
  name: string;
  createdBy: string;
  createdAt: number;
  closedAt?: number;
  active: boolean;
  roomId: string;
  messageCount: number;
}

const app = express();
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ limit: '100mb', extended: true }));

let mongoClient: MongoClient | null = null;
let mongoDb: Db | null = null;

const mongoUriStr = process.env.MONGODB_URI || '';
const isMongoConfigured = mongoUriStr && !mongoUriStr.includes('<username>') && mongoUriStr.trim() !== '';

const FILES_RETENTION_MS = 10 * 24 * 60 * 60 * 1000;

// In-memory cache for recent messages
const messageCache = new Map<string, { messages: ChatMessage[], lastFetched: number }>();

function bustMessageCache(roomId: string) {
  messageCache.delete(roomId);
}

async function initDatabase() {
  if (!isMongoConfigured) {
    console.error("FATAL: MONGODB_URI not configured on Vercel. Set it in Vercel Environment Variables.");
    return;
  }

  try {
    mongoClient = new MongoClient(mongoUriStr, {
      serverSelectionTimeoutMS: 10000,
      connectTimeoutMS: 10000,
    });
    await mongoClient.connect();
    mongoDb = mongoClient.db('chating');

    // Setup indexes
    await mongoDb.collection('messages').createIndex({ roomId: 1, timestamp: -1 });
    await mongoDb.collection('messages').createIndex({ sessionId: 1 });
    await mongoDb.collection('sessions').createIndex({ createdAt: -1 });
    await mongoDb.collection('sessions').createIndex({ roomId: 1, active: 1 });

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
        text: 'Terminal initialized in MongoDB Atlas. System status: SECURE.',
        type: 'text',
        timestamp: Date.now()
      });
    }
    console.log("MongoDB Atlas connected on Vercel.");
  } catch (e) {
    console.error("MongoDB connection failed on Vercel.", e);
  }
}

// Clean expired file payloads
async function cleanExpiredFilePayloads() {
  if (!mongoDb) return;
  const cutoff = Date.now() - FILES_RETENTION_MS;
  try {
    await mongoDb.collection('messages').updateMany(
      { type: { $in: ['file', 'folder', 'voice'] }, timestamp: { $lt: cutoff }, payload: { $exists: true, $ne: null } },
      { $set: { payload: null, text: '[FILE_EXPIRED: Payload auto-cleaned after 10 days]' } }
    );
  } catch (err) {
    console.error("File cleanup error:", err);
  }
}

async function getActiveSession(roomId: string): Promise<ChatSession | null> {
  if (!mongoDb) return null;
  const session = await mongoDb.collection('sessions').findOne({ roomId, active: true });
  if (!session) return null;
  return {
    id: session.id, name: session.name, createdBy: session.createdBy,
    createdAt: session.createdAt, closedAt: session.closedAt,
    active: session.active, roomId: session.roomId, messageCount: session.messageCount || 0
  };
}

async function getRooms(): Promise<ChatRoom[]> {
  if (!mongoDb) return [];
  try {
    const rooms = await mongoDb.collection('rooms').find().toArray();
    return rooms.map(r => ({ id: r.id, name: r.name, created: r.created || Date.now(), active: r.active !== false }));
  } catch (err) { console.error(err); return []; }
}

async function addRoom(room: ChatRoom): Promise<void> {
  if (!mongoDb) return;
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
  } catch (err) { console.error(err); return []; }
}

async function registerUser(username: string, codename?: string): Promise<void> {
  if (!mongoDb) return;
  const sanitized = String(username).trim();
  if (!sanitized) return;
  try {
    const exists = await mongoDb.collection('registered_users').findOne({ username: sanitized });
    if (!exists) await mongoDb.collection('registered_users').insertOne({ username: sanitized, codename: codename || sanitized, created: Date.now() });
  } catch (err) { console.error(err); }
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
  } catch (err) { console.error(err); return []; }
}

async function blockUser(username: string, block: boolean): Promise<void> {
  if (!mongoDb) return;
  if (block) {
    const exists = await mongoDb.collection('blocked_users').findOne({ username });
    if (!exists) await mongoDb.collection('blocked_users').insertOne({ username, timestamp: Date.now() });
  } else {
    await mongoDb.collection('blocked_users').deleteOne({ username });
  }
}

async function getMessages(roomId: string, sinceId?: string): Promise<ChatMessage[]> {
  if (!mongoDb) return [];

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
      if (sinceMsg) query.timestamp = { $gt: sinceMsg.timestamp };
    }
    const msgs = await mongoDb.collection('messages')
      .find(query).sort({ timestamp: 1 }).limit(500).toArray();
    const mapped = msgs.map(m => ({
      id: m.id, roomId: m.roomId, sender: m.sender, text: m.text,
      type: m.type, timestamp: m.timestamp, payload: m.payload,
      fileName: m.fileName, fileSize: m.fileSize, filePath: m.filePath, sessionId: m.sessionId
    }));
    if (!sinceId) {
      messageCache.set(roomId, { messages: mapped.slice(-200), lastFetched: Date.now() });
    }
    return mapped;
  } catch (err) { console.error(err); return []; }
}

async function addMessage(msg: ChatMessage): Promise<void> {
  if (!mongoDb) return;
  if (!msg.sessionId) {
    const activeSession = await getActiveSession(msg.roomId);
    if (activeSession) msg.sessionId = activeSession.id;
  }
  await mongoDb.collection('messages').insertOne(msg);
}

async function getTotalMessageCount(): Promise<number> {
  if (!mongoDb) return 0;
  try { return await mongoDb.collection('messages').countDocuments(); } catch { return 0; }
}

async function resetAllChats(): Promise<void> {
  if (!mongoDb) return;
  await mongoDb.collection('messages').deleteMany({});
  await mongoDb.collection('rooms').deleteMany({});
  await mongoDb.collection('sessions').deleteMany({});
  await mongoDb.collection('rooms').insertOne({ id: 'general-shell', name: 'SECURE_GENERAL_SHELL', created: Date.now(), active: true });
  await mongoDb.collection('messages').insertOne({ id: 'init-msg-reset', roomId: 'general-shell', sender: 'SYSTEM_DAEMON', text: 'Admin reset triggered. All logs deleted.', type: 'text', timestamp: Date.now() });
  messageCache.clear();
}

async function getSessions(roomId?: string, limit = 50): Promise<ChatSession[]> {
  if (!mongoDb) return [];
  const query: any = {};
  if (roomId) query.roomId = roomId;
  const sessions = await mongoDb.collection('sessions').find(query).sort({ createdAt: -1 }).limit(limit).toArray();
  return sessions.map(s => ({
    id: s.id, name: s.name, createdBy: s.createdBy, createdAt: s.createdAt,
    closedAt: s.closedAt, active: s.active, roomId: s.roomId, messageCount: s.messageCount || 0
  }));
}

async function createSession(name: string, createdBy: string, roomId: string): Promise<ChatSession> {
  if (!mongoDb) throw new Error("Database not connected");

  await mongoDb.collection('sessions').updateMany(
    { roomId, active: true },
    { $set: { active: false, closedAt: Date.now() } }
  );

  const session: ChatSession = {
    id: `session-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
    name: name.trim() || `Session ${new Date().toLocaleString()}`,
    createdBy, createdAt: Date.now(), active: true, roomId, messageCount: 0
  };

  await mongoDb.collection('sessions').insertOne(session);
  bustMessageCache(roomId);

  await addMessage({
    id: `sys-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
    roomId, sender: 'SYSTEM_DAEMON',
    text: `New session started: "${session.name}" by admin [${createdBy}].`,
    type: 'text', timestamp: Date.now(), sessionId: session.id
  });

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
    id: session.id, name: session.name, createdBy: session.createdBy,
    createdAt: session.createdAt, closedAt: Date.now(), active: false,
    roomId: session.roomId, messageCount: session.messageCount || 0
  };

  await addMessage({
    id: `sys-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
    roomId: closed.roomId, sender: 'SYSTEM_DAEMON',
    text: `Session ended: "${closed.name}". ${closed.messageCount} messages logged.`,
    type: 'text', timestamp: Date.now()
  });

  bustMessageCache(closed.roomId);
  return closed;
}

function idSanitize(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, '');
}

// --- REST API Routes ---

app.get('/api/rooms', async (req, res) => {
  try {
    const chambers = await getRooms();
    res.json(chambers);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
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
      roomId: id, sender: 'SYSTEM_DAEMON', text: 'Secure communication chamber initialized.', type: 'text', timestamp: Date.now()
    };
    await addMessage(createAlert);
    res.json(newRoom);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

app.get('/api/messages', async (req, res) => {
  try {
    const { roomId, since } = req.query;
    if (!roomId) return res.status(400).json({ error: 'Missing chamber parameters' });
    const messages = await getMessages(String(roomId), since ? String(since) : undefined);
    res.json(messages);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

app.post('/api/messages', async (req, res) => {
  try {
    const { roomId, sender, text, type, payload, fileName, fileSize, filePath, sessionId } = req.body;
    if (!roomId || !sender) {
      return res.status(400).json({ error: 'Missing required fields: roomId, sender' });
    }
    const sanitizedRoomId = idSanitize(roomId);
    const newMsg: ChatMessage = {
      id: `msg-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
      roomId: sanitizedRoomId, sender: String(sender).trim(),
      text: String(text || ''), type: type || 'text', timestamp: Date.now(),
      payload, fileName, fileSize, filePath, sessionId
    };
    await addMessage(newMsg);
    res.json(newMsg);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

app.post('/api/upload-files', async (req, res) => {
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
        roomId: sanitizedRoomId, sender: String(sender),
        text: `Uploaded File: ${file.name} (${(file.size / 1024).toFixed(1)} KB)`,
        type: 'file', timestamp: Date.now(),
        payload: file.base64, fileName: file.name, fileSize: file.size, sessionId
      };
      await addMessage(newMsg);
    } else {
      const totalSize = files.reduce((acc: number, f: any) => acc + (f.size || 0), 0);
      const folderName = files[0].path ? files[0].path.split('/')[0] : 'UPLOADED_FOLDER';
      const folderMetadata = files.map((f: any) => ({ name: f.name, size: f.size, path: f.path, base64: f.base64 }));
      const newMsg: ChatMessage = {
        id: `msg-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
        roomId: sanitizedRoomId, sender: String(sender),
        text: `Uploaded Directory: [${folderName}/] ${files.length} files (${(totalSize / 1024).toFixed(1)} KB)`,
        type: 'folder', timestamp: Date.now(),
        payload: JSON.stringify(folderMetadata), fileName: folderName, fileSize: totalSize, sessionId
      };
      await addMessage(newMsg);
    }
    res.json({ success: true });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

app.get('/api/users/:username/info', async (req, res) => {
  try {
    if (!mongoDb) return res.status(500).json({ error: 'DB not connected' });
    const sanitized = String(req.params.username).trim();
    if (!sanitized) return res.status(400).json({ error: 'Missing username' });
    const user = await mongoDb.collection('registered_users').findOne({ username: sanitized });
    if (!user) return res.status(404).json({ error: 'Node not found' });
    res.json({ codename: user.codename || sanitized, passcode: user.passcode || '0000', username: user.username, created: user.created || Date.now() });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

app.get('/api/admin/users', async (req, res) => {
  try {
    const reg = await getRegisteredUsers();
    const blocked = await getBlockedUsers();
    res.json({ registered: reg, active: [], blocked });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

app.post('/api/admin/users/block', async (req, res) => {
  try {
    const { username, block } = req.body;
    if (!username) return res.status(400).json({ error: 'Missing username parameter' });
    await blockUser(String(username).trim(), !!block);
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

app.post('/api/admin/users/delete', async (req, res) => {
  try {
    const { username } = req.body;
    if (!username) return res.status(400).json({ error: 'Missing username parameter' });
    await deleteUser(String(username).trim());
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/admin/rooms/:id', async (req, res) => {
  try {
    const roomId = req.params.id;
    if (!roomId) return res.status(400).json({ error: 'Missing room identifier' });
    await removeRoom(roomId);
    res.json({ success: true, roomId });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

app.post('/api/admin/reset', async (req, res) => {
  try {
    const { passcode } = req.body;
    if (passcode !== '0000') return res.status(403).json({ error: 'UNAUTHORIZED' });
    await resetAllChats();
    res.json({ success: true, message: "LOGS_WIPED_SUCCESSFULLY" });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// --- Session Management Endpoints ---
app.get('/api/admin/sessions', async (req, res) => {
  try {
    const { roomId } = req.query;
    const sessions = await getSessions(roomId ? String(roomId) : undefined);
    const totalMessages = await getTotalMessageCount();
    res.json({ sessions, totalMessages });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/sessions', async (req, res) => {
  try {
    const { name, roomId, adminName } = req.body;
    if (!name || !roomId || !adminName) {
      return res.status(400).json({ error: 'Missing required fields: name, roomId, adminName' });
    }
    const session = await createSession(name, adminName, roomId);
    res.json(session);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/sessions/:id/close', async (req, res) => {
  try {
    const closed = await closeSession(req.params.id);
    if (!closed) return res.status(404).json({ error: 'Session not found' });
    res.json(closed);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

app.get('/api/admin/stats', async (req, res) => {
  try {
    const totalMessages = await getTotalMessageCount();
    const totalUsers = (await getRegisteredUsers()).length;
    const totalSessions = (await getSessions()).length;
    res.json({ totalMessages, totalUsers, totalSessions, dbMode: 'MongoDB Atlas' });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
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

import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';

dotenv.config();

const SEED_PASSCODE = '0000';

function generateId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
}

async function seed() {
  const mongoUriStr = process.env.MONGODB_URI || '';
  if (!mongoUriStr || mongoUriStr.includes('<username>') || mongoUriStr.trim() === '') {
    console.error('FATAL: MONGODB_URI is not configured. Set it in .env');
    process.exit(1);
  }

  const client = new MongoClient(mongoUriStr, {
    serverSelectionTimeoutMS: 15000,
    connectTimeoutMS: 15000,
  });

  try {
    console.log('Connecting to MongoDB Atlas cluster...');
    await client.connect();
    console.log('Connected successfully.');

    const db = client.db('chating');
    console.log('Using database: chating\n');

    const roomsCol = db.collection('rooms');
    const messagesCol = db.collection('messages');
    const sessionsCol = db.collection('sessions');
    const usersCol = db.collection('registered_users');

    // --- Ensure indexes ---
    console.log('Setting up indexes...');
    await messagesCol.createIndex({ timestamp: 1 }, { expireAfterSeconds: 0 }).catch(() => {});
    await messagesCol.createIndex({ roomId: 1, timestamp: -1 });
    await messagesCol.createIndex({ sessionId: 1 });
    await sessionsCol.createIndex({ createdAt: -1 });
    await sessionsCol.createIndex({ roomId: 1, active: 1 });

    // --- Seed rooms ---
    const existingRooms = await roomsCol.countDocuments();
    if (existingRooms === 0) {
      console.log('Seeding rooms...');
      await roomsCol.insertMany([
        { id: 'general-shell', name: 'SECURE_GENERAL_SHELL', created: Date.now(), active: true },
        { id: 'netsec-comms', name: 'NETSEC_OPERATIONAL_COMMS', created: Date.now(), active: true },
      ]);
    } else {
      console.log(`Rooms already exist (${existingRooms}), skipping.`);
    }

    // --- Seed sample messages ---
    const existingMessages = await messagesCol.countDocuments();
    if (existingMessages === 0) {
      console.log('Seeding sample messages...');
      const now = Date.now();
      const sampleMessages = [
        { id: generateId('init'), roomId: 'general-shell', sender: 'SYSTEM_DAEMON', text: 'chating database initialized. System status: SECURE.', type: 'text', timestamp: now },
        { id: generateId('msg'), roomId: 'general-shell', sender: 'SYSTEM_DAEMON', text: 'All communications are persisted in MongoDB Atlas. Data survives when no users are connected.', type: 'text', timestamp: now + 1000 },
        { id: generateId('msg'), roomId: 'general-shell', sender: 'SYSTEM_DAEMON', text: 'Admin can clear data with passcode 0000 and start a new session.', type: 'text', timestamp: now + 2000 },
        { id: generateId('msg'), roomId: 'netsec-comms', sender: 'SYSTEM_DAEMON', text: 'NETSEC operational channel ready. Encrypted comms active.', type: 'text', timestamp: now + 500 },
      ];
      await messagesCol.insertMany(sampleMessages);
    } else {
      console.log(`Messages already exist (${existingMessages}), skipping.`);
    }

    // --- Seed a demo user ---
    const existingUsers = await usersCol.countDocuments();
    if (existingUsers === 0) {
      console.log('Seeding demo user...');
      await usersCol.insertOne({
        username: 'admin',
        codename: 'ROOT_OPERATOR',
        passcode: SEED_PASSCODE,
        created: Date.now(),
      });
    }

    // --- Run Verification ---
    console.log('\n=== VERIFICATION ===');
    const roomCount = await roomsCol.countDocuments();
    const msgCount = await messagesCol.countDocuments();
    const userCount = await usersCol.countDocuments();
    const sessionCount = await sessionsCol.countDocuments();

    console.log(`  Rooms:        ${roomCount}`);
    console.log(`  Messages:     ${msgCount}`);
    console.log(`  Users:        ${userCount}`);
    console.log(`  Sessions:     ${sessionCount}`);

    const rooms = await roomsCol.find().toArray();
    console.log('\nRooms:');
    rooms.forEach(r => console.log(`  - ${r.id} (${r.name})`));

    const messages = await messagesCol.find().sort({ timestamp: 1 }).limit(5).toArray();
    console.log('\nRecent messages:');
    messages.forEach(m => console.log(`  [${new Date(m.timestamp).toISOString()}] ${m.sender}: ${m.text}`));

    console.log('\n=== PERSISTENCE CONFIRMATION ===');
    console.log('  Data is stored in the "chating" database on MongoDB Atlas.');
    console.log('  When no users (nodes) are connected, data persists in the database.');
    console.log('  Any user can come back anytime and retrieve the full chat history.');
    console.log('  Admin can explicitly clear all data via POST /api/admin/reset');
    console.log('    (requires passcode: 0000, which creates a fresh session).');
    console.log('  As long as no reset is performed, the data remains accessible.\n');

    console.log('Seed completed successfully. Database "chating" is ready.');
  } catch (err) {
    console.error('Seed failed:', err);
    process.exit(1);
  } finally {
    await client.close();
    console.log('Connection closed.');
  }
}

seed();

import express from 'express';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import dotenv from 'dotenv';
import { GoogleGenAI, Type } from '@google/genai';
import { initializeApp } from 'firebase/app';
import { getFirestore, doc, getDoc, setDoc } from 'firebase/firestore';

dotenv.config();

// Initialize Firebase Firestore on Server for 100% Permanent Cloud Sync & Tracker API Persistence
const firebaseConfigPath = path.join(process.cwd(), 'firebase-applet-config.json');
const firebaseConfig = JSON.parse(fs.readFileSync(firebaseConfigPath, 'utf-8'));
const firebaseApp = initializeApp(firebaseConfig, 'krypton-server-firestore');
const firestoreDb = getFirestore(firebaseApp, firebaseConfig.firestoreDatabaseId);
const TRACKER_FIRESTORE_DOC_ID = 'global_tracker_v1';

const app = express();
const PORT = 3000;

// Strict Security & CORS Headers Middleware (Allows Standalone Capacitor Android APK https://localhost & SaaS Tracker API)
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-vault-token');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }
  next();
});

app.use(express.json({ limit: '15mb' }));

// Initialize Gemini SDK on server-side with required telemetry header
function getGenAIClient() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured on the server.');
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

// Local disk cache + permanent Firestore store
const SYNC_STORAGE_FILE = path.join(process.cwd(), '.vault_sync_store.json');
const TRACKER_METADATA_FILE = path.join(process.cwd(), '.vault_tracker_metadata.json');

interface EncryptedSyncRecord {
  syncId: string;
  salt: string;
  iv: string;
  ciphertext: string;
  updatedAt: string;
  version: number;
}

interface StoredTrackerToken {
  id: string;
  label: string;
  tokenHash: string;
  tokenPreview: string;
  scope: 'metadata:read';
  createdAt: string;
  lastUsedAt?: string;
  revoked: boolean;
}

interface TrackerMetadataStore {
  tokens: StoredTrackerToken[];
  items: Array<{
    id: string;
    label: string;
    product_name: string;
    service_name: string;
    secret_type: string;
    environment: string;
    status: string;
    last_rotated_date: string;
    next_rotation_due?: string;
    expiry_date?: string;
    deep_link: string;
    updated_at: string;
  }>;
}

function sanitizeSyncId(rawId: string): string {
  return rawId
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '-')
    .slice(0, 128);
}

function readLocalSyncStore(): Record<string, EncryptedSyncRecord> {
  try {
    if (fs.existsSync(SYNC_STORAGE_FILE)) {
      return JSON.parse(fs.readFileSync(SYNC_STORAGE_FILE, 'utf-8'));
    }
  } catch (e) {
    console.error('Failed to read local sync store:', e);
  }
  return {};
}

function writeLocalSyncStore(store: Record<string, EncryptedSyncRecord>) {
  try {
    fs.writeFileSync(SYNC_STORAGE_FILE, JSON.stringify(store, null, 2), 'utf-8');
  } catch (e) {
    console.error('Failed to write local sync store:', e);
  }
}

function readLocalTrackerStore(): TrackerMetadataStore {
  try {
    if (fs.existsSync(TRACKER_METADATA_FILE)) {
      return JSON.parse(fs.readFileSync(TRACKER_METADATA_FILE, 'utf-8'));
    }
  } catch (e) {
    console.error('Failed to read local tracker store:', e);
  }
  return { tokens: [], items: [] };
}

function writeLocalTrackerStore(store: TrackerMetadataStore) {
  try {
    fs.writeFileSync(TRACKER_METADATA_FILE, JSON.stringify(store, null, 2), 'utf-8');
  } catch (e) {
    console.error('Failed to write local tracker store:', e);
  }
}

async function readTrackerStoreFromFirestore(): Promise<TrackerMetadataStore> {
  try {
    const snap = await getDoc(doc(firestoreDb, 'tracker_store', TRACKER_FIRESTORE_DOC_ID));
    if (snap.exists()) {
      const data = snap.data();
      const loaded: TrackerMetadataStore = {
        tokens: Array.isArray(data.tokens) ? data.tokens : [],
        items: Array.isArray(data.items) ? data.items : [],
      };
      writeLocalTrackerStore(loaded);
      return loaded;
    }
  } catch (e) {
    console.error('Firestore tracker read fallback to local:', e);
  }
  return readLocalTrackerStore();
}

async function writeTrackerStoreToFirestore(store: TrackerMetadataStore): Promise<void> {
  writeLocalTrackerStore(store);
  try {
    const cleanTokens = store.tokens.slice(0, 200).map((t) => ({
      id: String(t.id),
      label: String(t.label),
      tokenHash: String(t.tokenHash),
      tokenPreview: String(t.tokenPreview),
      scope: 'metadata:read' as const,
      createdAt: String(t.createdAt),
      ...(t.lastUsedAt ? { lastUsedAt: String(t.lastUsedAt) } : {}),
      revoked: Boolean(t.revoked),
    }));

    const cleanItems = store.items.slice(0, 500).map((i) => ({
      id: String(i.id),
      label: String(i.label),
      product_name: String(i.product_name),
      service_name: String(i.service_name),
      secret_type: String(i.secret_type),
      environment: String(i.environment),
      status: String(i.status),
      last_rotated_date: String(i.last_rotated_date),
      ...(i.next_rotation_due ? { next_rotation_due: String(i.next_rotation_due) } : {}),
      ...(i.expiry_date ? { expiry_date: String(i.expiry_date) } : {}),
      deep_link: String(i.deep_link),
      updated_at: String(i.updated_at),
    }));

    await setDoc(doc(firestoreDb, 'tracker_store', TRACKER_FIRESTORE_DOC_ID), {
      storeId: TRACKER_FIRESTORE_DOC_ID,
      tokens: cleanTokens,
      items: cleanItems,
      updatedAt: new Date().toISOString().slice(0, 64),
    });
  } catch (e) {
    console.error('Firestore tracker write error:', e);
  }
}

function hashToken(rawToken: string): string {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

// ============================================================================
// 1. SAAS TRACKER READ-ONLY METADATA API & REVOCABLE TOKEN ENDPOINTS
// Persisted permanently in Firebase Firestore (/tracker_store/global_tracker_v1)
// Strictly returns metadata only — NEVER receives or returns secret_value or notes!
// ============================================================================
app.get('/api/tracker/tokens', async (_req, res) => {
  const store = await readTrackerStoreFromFirestore();
  const safeTokens = store.tokens.map(({ tokenHash, ...rest }) => rest);
  return res.json({ tokens: safeTokens, storage: 'firebase-firestore' });
});

app.post('/api/tracker/tokens/create', async (req, res) => {
  const { label } = req.body;
  const cleanLabel = (label || 'StackTrack Read-Only Token').trim().slice(0, 64);
  const rawRandom = crypto.randomBytes(24).toString('hex');
  const rawToken = `kv_ro_${rawRandom}`;
  const tokenHash = hashToken(rawToken);
  const tokenPreview = `${rawToken.slice(0, 10)}...${rawToken.slice(-4)}`;

  const store = await readTrackerStoreFromFirestore();
  const newRecord: StoredTrackerToken = {
    id: `tok_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
    label: cleanLabel,
    tokenHash,
    tokenPreview,
    scope: 'metadata:read',
    createdAt: new Date().toISOString(),
    revoked: false,
  };
  store.tokens.unshift(newRecord);
  await writeTrackerStoreToFirestore(store);

  const { tokenHash: _omit, ...safeRecord } = newRecord;
  return res.json({
    token: rawToken, // Shown once to the user upon creation
    record: safeRecord,
  });
});

app.post('/api/tracker/tokens/revoke', async (req, res) => {
  const { id } = req.body;
  const store = await readTrackerStoreFromFirestore();
  const target = store.tokens.find((t) => t.id === id);
  if (!target) {
    return res.status(404).json({ error: 'Token not found.' });
  }
  target.revoked = true;
  await writeTrackerStoreToFirestore(store);
  return res.json({ success: true, id });
});

// Sync metadata-only projection from the unlocked client to the read-only Firestore API store
app.post('/api/tracker/sync-metadata', async (req, res) => {
  const { items } = req.body;
  if (!Array.isArray(items)) {
    return res.status(400).json({ error: 'Items array required.' });
  }

  // Strictly whitelist ONLY non-sensitive metadata fields
  const sanitized = items.slice(0, 500).map((item: any) => ({
    id: String(item.id || ''),
    label: String(item.label || ''),
    product_name: String(item.product_name || ''),
    service_name: String(item.service_name || ''),
    secret_type: String(item.secret_type || 'api_key'),
    environment: String(item.environment || 'production'),
    status: String(item.status || 'active'),
    last_rotated_date: String(item.last_rotated_date || ''),
    next_rotation_due: item.next_rotation_due ? String(item.next_rotation_due) : undefined,
    expiry_date: item.expiry_date ? String(item.expiry_date) : undefined,
    deep_link: `/vault/api-keys/${encodeURIComponent(String(item.id || ''))}`,
    updated_at: String(item.updated_at || new Date().toISOString()),
  }));

  const store = await readTrackerStoreFromFirestore();
  store.items = sanitized;
  await writeTrackerStoreToFirestore(store);

  return res.json({ syncedCount: sanitized.length, storage: 'firebase-firestore' });
});

// Middleware to authenticate external SaaS Stack Tracker requests via Bearer token
async function requireTrackerReadToken(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
) {
  const authHeader = req.headers.authorization || '';
  const bearerToken = authHeader.startsWith('Bearer ')
    ? authHeader.slice(7).trim()
    : (req.headers['x-vault-token'] as string) || '';

  if (!bearerToken || !bearerToken.startsWith('kv_ro_')) {
    return res.status(401).json({
      error: 'Missing or invalid Authorization Bearer token (expected kv_ro_... read-only token).',
    });
  }

  const incomingHash = hashToken(bearerToken);
  const store = await readTrackerStoreFromFirestore();
  const matched = store.tokens.find((t) => t.tokenHash === incomingHash && !t.revoked);

  if (!matched) {
    return res.status(403).json({
      error: 'Read-only token is invalid or has been revoked inside Krypton Vault.',
    });
  }

  matched.lastUsedAt = new Date().toISOString();
  await writeTrackerStoreToFirestore(store);
  (req as any).trackerStore = store;
  next();
}

// Read-Only Metadata Endpoint for SaaS Tracker App (All items)
app.get('/api/tracker/metadata', requireTrackerReadToken, async (req, res) => {
  const store: TrackerMetadataStore = (req as any).trackerStore || (await readTrackerStoreFromFirestore());
  const { product, environment, status } = req.query;
  let results = store.items;

  if (product && typeof product === 'string') {
    results = results.filter((i) => i.product_name.toLowerCase() === product.toLowerCase());
  }
  if (environment && typeof environment === 'string') {
    results = results.filter((i) => i.environment.toLowerCase() === environment.toLowerCase());
  }
  if (status && typeof status === 'string') {
    results = results.filter((i) => i.status.toLowerCase() === status.toLowerCase());
  }

  return res.json({
    vault: 'KryptonVault',
    storage: 'firebase-firestore',
    scope: 'metadata:read',
    count: results.length,
    items: results,
  });
});

// Read-Only Metadata Endpoint for SaaS Tracker App (Single item by ID)
app.get('/api/tracker/metadata/:id', requireTrackerReadToken, async (req, res) => {
  const store: TrackerMetadataStore = (req as any).trackerStore || (await readTrackerStoreFromFirestore());
  const item = store.items.find((i) => i.id === req.params.id);
  if (!item) {
    return res.status(404).json({ error: 'Secret metadata reference not found.' });
  }
  return res.json({
    vault: 'KryptonVault',
    storage: 'firebase-firestore',
    scope: 'metadata:read',
    item,
  });
});

// ============================================================================
// 2. ZERO-KNOWLEDGE ENCRYPTED CLOUD SYNC ENDPOINTS (Backed by Firebase Firestore)
// Server & Firestore only ever receive AES-256-GCM ciphertext, IV, and PBKDF2 salt.
// ============================================================================
app.post('/api/sync/push', async (req, res) => {
  try {
    const { syncId, salt, iv, ciphertext } = req.body;
    const cleanId = sanitizeSyncId(String(syncId || ''));
    if (cleanId.length < 6) {
      return res.status(400).json({ error: 'Sync Vault ID must be at least 6 characters.' });
    }
    if (!salt || !iv || !ciphertext) {
      return res
        .status(400)
        .json({ error: 'Missing encrypted payload parameters (salt, iv, ciphertext).' });
    }

    const record: EncryptedSyncRecord = {
      syncId: cleanId,
      salt: String(salt).slice(0, 256),
      iv: String(iv).slice(0, 256),
      ciphertext: String(ciphertext).slice(0, 900000),
      updatedAt: new Date().toISOString().slice(0, 64),
      version: 3,
    };

    // Save to local cache + permanently to Firebase Firestore
    const store = readLocalSyncStore();
    store[cleanId] = record;
    writeLocalSyncStore(store);

    await setDoc(doc(firestoreDb, 'vault_sync', cleanId), record);

    return res.json({
      success: true,
      storage: 'firebase-firestore',
      syncId: cleanId,
      updatedAt: record.updatedAt,
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Failed to push encrypted sync payload.' });
  }
});

app.get('/api/sync/pull/:syncId', async (req, res) => {
  try {
    const cleanId = sanitizeSyncId(req.params.syncId || '');
    if (cleanId.length < 6) {
      return res.status(400).json({ error: 'Sync Vault ID (min 6 chars) is required.' });
    }

    // Try reading from permanent Firebase Firestore first
    try {
      const snap = await getDoc(doc(firestoreDb, 'vault_sync', cleanId));
      if (snap.exists()) {
        const data = snap.data() as EncryptedSyncRecord;
        return res.json(data);
      }
    } catch (firestoreErr) {
      console.error('Firestore sync pull fallback to local cache:', firestoreErr);
    }

    const store = readLocalSyncStore();
    const record = store[cleanId];
    if (!record) {
      return res.status(404).json({ error: 'No encrypted vault backup found for this Sync ID.' });
    }
    return res.json(record);
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Failed to pull encrypted sync payload.' });
  }
});

// ============================================================================
// 3. GEMINI AI RECEIPT / CARD / SMS SCANNER (Free Tier: gemini-3.8-flash)
// ============================================================================
app.post('/api/ai/scan-document', async (req, res) => {
  try {
    const { imageBase64, mimeType, rawText, mode } = req.body;
    const ai = getGenAIClient();

    const parts: any[] = [];
    if (imageBase64 && mimeType) {
      const cleanBase64 = imageBase64.replace(/^data:[^;]+;base64,/, '');
      parts.push({
        inlineData: {
          mimeType,
          data: cleanBase64,
        },
      });
    }

    if (mode === 'transaction') {
      parts.push({
        text: `Analyze this bank transfer receipt, SMS alert, or invoice ${
          rawText ? `("${rawText}")` : ''
        }. Extract the transaction details accurately. For type, return "income" if money was received/credited or "expense" if money was sent/debited/paid.`,
      });

      const response = await ai.models.generateContent({
        model: 'gemini-3.8-flash',
        contents: { parts },
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              amount: { type: Type.NUMBER, description: 'Numeric transaction amount' },
              type: { type: Type.STRING, description: '"income" or "expense"' },
              category: {
                type: Type.STRING,
                description: 'Short category like Transfer, Utilities, Salary, Groceries, Merchant',
              },
              date: {
                type: Type.STRING,
                description: 'ISO date YYYY-MM-DD if visible, else empty string',
              },
              note: {
                type: Type.STRING,
                description: 'Brief summary including reference number or counterparty name',
              },
              currency: { type: Type.STRING, description: 'Currency code like ETB, USD, EUR, GBP' },
            },
            required: ['amount', 'type', 'category', 'note'],
          },
        },
      });

      const parsed = JSON.parse(response.text?.trim() || '{}');
      return res.json(parsed);
    }

    // Default mode: Account / Card / Bank Slip extraction
    parts.push({
      text: `Analyze this bank slip, account statement, card image, or notification text ${
        rawText ? `("${rawText}")` : ''
      }. Extract non-PIN account metadata to populate a financial vault form. Never invent data that is not present.`,
    });

    const response = await ai.models.generateContent({
      model: 'gemini-3.8-flash',
      contents: { parts },
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            name: {
              type: Type.STRING,
              description: 'Account holder name or descriptive account title',
            },
            accountNumber: {
              type: Type.STRING,
              description: 'Bank account number or wallet number',
            },
            phoneNumber: { type: Type.STRING, description: 'Phone number if present' },
            orgName: {
              type: Type.STRING,
              description:
                'Bank or wallet institution name (e.g. Commercial Bank of Ethiopia, Bank of Abyssinia, Telebirr, Chase)',
            },
            branchName: { type: Type.STRING, description: 'Branch name if present' },
            currency: {
              type: Type.STRING,
              description: '3-letter currency code: ETB, USD, EUR, GBP, or CAD',
            },
            currentBalance: {
              type: Type.NUMBER,
              description: 'Balance or total amount if present, otherwise 0',
            },
            hasAtm: {
              type: Type.BOOLEAN,
              description: 'True if an ATM/debit/credit card number is visible',
            },
            atmNumber: { type: Type.STRING, description: 'Card number digits if visible' },
            expiry: { type: Type.STRING, description: 'Card expiry MM/YY if visible' },
            memo: {
              type: Type.STRING,
              description: 'Any reference code, SWIFT/BIC, or useful note from the document',
            },
          },
        },
      },
    });

    const parsed = JSON.parse(response.text?.trim() || '{}');
    return res.json(parsed);
  } catch (err: any) {
    console.error('Gemini scan error:', err);
    return res.status(500).json({
      error: err.message || 'AI document scan failed.',
    });
  }
});

// ============================================================================
// 4. GEMINI AI SMART FINANCIAL INSIGHTS (Free Tier: gemini-3.8-flash)
// ============================================================================
app.post('/api/ai/insights', async (req, res) => {
  try {
    const { summaryPayload, baseCurrency } = req.body;
    const ai = getGenAIClient();

    const response = await ai.models.generateContent({
      model: 'gemini-3.8-flash',
      contents: `You are a concise, high-precision personal wealth & multi-currency treasury analyst.
Analyze this anonymized vault ledger summary (Base Currency: ${baseCurrency || 'ETB'}):
${JSON.stringify(summaryPayload, null, 2)}

Provide 3 concrete, actionable financial insights covering cashflow health, multi-currency exposure (e.g. ETB vs USD/EUR purchasing power), and expense optimization.`,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            headline: { type: Type.STRING, description: 'One-sentence executive treasury summary' },
            healthRating: {
              type: Type.STRING,
              description: 'Optimal, Balanced, or Needs Attention',
            },
            insights: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  title: { type: Type.STRING },
                  detail: { type: Type.STRING },
                  action: { type: Type.STRING },
                },
                required: ['title', 'detail', 'action'],
              },
            },
          },
          required: ['headline', 'healthRating', 'insights'],
        },
      },
    });

    const parsed = JSON.parse(response.text?.trim() || '{}');
    return res.json(parsed);
  } catch (err: any) {
    console.error('Gemini insights error:', err);
    return res.status(500).json({
      error: err.message || 'Failed to generate AI financial insights.',
    });
  }
});

// ============================================================================
// 5. VITE MIDDLEWARE (DEV) OR STATIC DIST (PROD)
// ============================================================================
async function startServer() {
  if (process.env.NODE_ENV === 'production') {
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  } else {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: false, watch: null },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Krypton Vault Server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();

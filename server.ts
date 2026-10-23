import express from 'express';
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import { GoogleGenAI, Type } from '@google/genai';

dotenv.config();

const app = express();
const PORT = 3000;

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

// Persistent local file store for Zero-Knowledge Encrypted Cloud Sync blobs
const SYNC_STORAGE_FILE = path.join(process.cwd(), '.vault_sync_store.json');

interface EncryptedSyncRecord {
  syncId: string;
  salt: string;
  iv: string;
  ciphertext: string;
  updatedAt: string;
  version: number;
}

function readSyncStore(): Record<string, EncryptedSyncRecord> {
  try {
    if (fs.existsSync(SYNC_STORAGE_FILE)) {
      const raw = fs.readFileSync(SYNC_STORAGE_FILE, 'utf-8');
      return JSON.parse(raw);
    }
  } catch (e) {
    console.error('Failed to read sync store:', e);
  }
  return {};
}

function writeSyncStore(store: Record<string, EncryptedSyncRecord>) {
  try {
    fs.writeFileSync(SYNC_STORAGE_FILE, JSON.stringify(store, null, 2), 'utf-8');
  } catch (e) {
    console.error('Failed to write sync store:', e);
  }
}

// ============================================================================
// 1. ZERO-KNOWLEDGE ENCRYPTED CLOUD SYNC ENDPOINTS
// Server only ever receives AES-256-GCM ciphertext, IV, and PBKDF2 salt.
// ============================================================================
app.post('/api/sync/push', (req, res) => {
  try {
    const { syncId, salt, iv, ciphertext } = req.body;
    if (!syncId || typeof syncId !== 'string' || syncId.trim().length < 6) {
      return res.status(400).json({ error: 'Sync Vault ID must be at least 6 characters.' });
    }
    if (!salt || !iv || !ciphertext) {
      return res.status(400).json({ error: 'Missing encrypted payload parameters (salt, iv, ciphertext).' });
    }

    const cleanId = syncId.trim().toLowerCase();
    const store = readSyncStore();
    const record: EncryptedSyncRecord = {
      syncId: cleanId,
      salt,
      iv,
      ciphertext,
      updatedAt: new Date().toISOString(),
      version: 2,
    };
    store[cleanId] = record;
    writeSyncStore(store);

    return res.json({
      success: true,
      syncId: cleanId,
      updatedAt: record.updatedAt,
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Failed to push encrypted sync payload.' });
  }
});

app.get('/api/sync/pull/:syncId', (req, res) => {
  try {
    const cleanId = (req.params.syncId || '').trim().toLowerCase();
    if (!cleanId) {
      return res.status(400).json({ error: 'Sync Vault ID is required.' });
    }
    const store = readSyncStore();
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
// 2. GEMINI AI RECEIPT / CARD / SMS SCANNER (Free Tier: gemini-3.8-flash)
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
              category: { type: Type.STRING, description: 'Short category like Transfer, Utilities, Salary, Groceries, Merchant' },
              date: { type: Type.STRING, description: 'ISO date YYYY-MM-DD if visible, else empty string' },
              note: { type: Type.STRING, description: 'Brief summary including reference number or counterparty name' },
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
            name: { type: Type.STRING, description: 'Account holder name or descriptive account title' },
            accountNumber: { type: Type.STRING, description: 'Bank account number or wallet number' },
            phoneNumber: { type: Type.STRING, description: 'Phone number if present' },
            orgName: { type: Type.STRING, description: 'Bank or wallet institution name (e.g. Commercial Bank of Ethiopia, Bank of Abyssinia, Telebirr, Chase)' },
            branchName: { type: Type.STRING, description: 'Branch name if present' },
            currency: { type: Type.STRING, description: '3-letter currency code: ETB, USD, EUR, GBP, or CAD' },
            currentBalance: { type: Type.NUMBER, description: 'Balance or total amount if present, otherwise 0' },
            hasAtm: { type: Type.BOOLEAN, description: 'True if an ATM/debit/credit card number is visible' },
            atmNumber: { type: Type.STRING, description: 'Card number digits if visible' },
            expiry: { type: Type.STRING, description: 'Card expiry MM/YY if visible' },
            memo: { type: Type.STRING, description: 'Any reference code, SWIFT/BIC, or useful note from the document' },
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
// 3. GEMINI AI SMART FINANCIAL INSIGHTS (Free Tier: gemini-3.8-flash)
// Strictly receives anonymized currency/category totals — ZERO account numbers or PINs!
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
            healthRating: { type: Type.STRING, description: 'Optimal, Balanced, or Needs Attention' },
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
// 4. VITE MIDDLEWARE (DEV) OR STATIC DIST (PROD)
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
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Krypton Vault Server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();

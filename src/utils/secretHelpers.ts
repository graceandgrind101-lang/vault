/**
 * Krypton Vault - API Keys & Secrets Lifecycle, CSV Import/Export, & Urgency Engine
 * Strictly separates metadata from client-encrypted secret values.
 */

import {
  SecretEnvironment,
  SecretItem,
  SecretMetadataProjection,
  SecretStatus,
  SecretType,
} from '../types/secret';
import { encryptSecretString } from './crypto';

export const SECRET_TYPE_LABELS: Record<SecretType, string> = {
  api_key: 'API Key',
  password: 'Password',
  access_token: 'Access Token',
  recovery_code: 'Admin / Recovery Code',
  database_url: 'Database URL',
  webhook_secret: 'Webhook Secret',
  ssh_key: 'SSH Key',
  other: 'Other Secret',
};

export const DEFAULT_SAAS_PRODUCTS = [
  'Shared / all products',
  'Pharmacy Management SaaS',
  'Restaurant & POS Cloud',
  'Cafeteria & Inventory',
  'Minimarket ERP',
  'Electronics Shop Manager',
];

export const DEFAULT_SAAS_SERVICES = [
  'Stripe',
  'Telegram Bot API',
  'Supabase',
  'Cloudflare',
  'Google Maps Platform',
  'Resend Email',
  'Sentry Monitoring',
  'Neon PostgreSQL',
  'Firebase Auth',
  'Chapa Payment Gateway',
];

/**
 * Computes next_rotation_due (YYYY-MM-DD) from last_rotated_date + rotation_interval_days
 */
export function computeNextRotationDue(
  lastRotatedDate: string,
  intervalDays?: number
): string | undefined {
  if (!lastRotatedDate || !intervalDays || intervalDays <= 0) return undefined;
  const base = new Date(`${lastRotatedDate}T00:00:00Z`);
  if (isNaN(base.getTime())) return undefined;
  base.setUTCDate(base.getUTCDate() + intervalDays);
  return base.toISOString().split('T')[0];
}

export interface SecretUrgencyAssessment {
  level: 'healthy' | 'due_soon' | 'overdue' | 'inactive';
  bucket: 'overdue' | 'due_7' | 'due_14' | 'due_custom' | 'healthy' | 'inactive';
  daysRemaining: number | null;
  effectiveDueDate?: string;
  label: string; // Explicit text for accessibility (not color alone)
}

/**
 * Evaluates rotation & expiry status against today's date and a custom reminder window.
 */
export function evaluateSecretUrgency(
  item: SecretItem,
  customWindowDays: number = 30
): SecretUrgencyAssessment {
  if (item.status === 'revoked') {
    return {
      level: 'inactive',
      bucket: 'inactive',
      daysRemaining: null,
      label: 'Revoked (Inactive)',
    };
  }

  const todayStr = new Date().toISOString().split('T')[0];
  const todayMs = new Date(`${todayStr}T00:00:00Z`).getTime();

  // Pick the earliest upcoming deadline between next_rotation_due and expiry_date
  const candidates: string[] = [];
  if (item.next_rotation_due) candidates.push(item.next_rotation_due);
  if (item.expiry_date) candidates.push(item.expiry_date);
  candidates.sort();

  const earliestDate = candidates[0];

  if (item.status === 'expired') {
    return {
      level: 'overdue',
      bucket: 'overdue',
      daysRemaining: -1,
      effectiveDueDate: earliestDate,
      label: 'Expired · Action Required',
    };
  }

  if (!earliestDate) {
    return {
      level: 'healthy',
      bucket: 'healthy',
      daysRemaining: null,
      label: 'Healthy · Active',
    };
  }

  const targetMs = new Date(`${earliestDate}T00:00:00Z`).getTime();
  const diffDays = Math.round((targetMs - todayMs) / (1000 * 60 * 60 * 24));

  if (diffDays < 0) {
    return {
      level: 'overdue',
      bucket: 'overdue',
      daysRemaining: diffDays,
      effectiveDueDate: earliestDate,
      label: `Overdue (${Math.abs(diffDays)}d ago)`,
    };
  }

  if (diffDays === 0) {
    return {
      level: 'overdue',
      bucket: 'overdue',
      daysRemaining: 0,
      effectiveDueDate: earliestDate,
      label: 'Due Today',
    };
  }

  if (diffDays <= 7) {
    return {
      level: 'due_soon',
      bucket: 'due_7',
      daysRemaining: diffDays,
      effectiveDueDate: earliestDate,
      label: `Due in ${diffDays}d (≤7d)`,
    };
  }

  if (diffDays <= 14) {
    return {
      level: 'due_soon',
      bucket: 'due_14',
      daysRemaining: diffDays,
      effectiveDueDate: earliestDate,
      label: `Due in ${diffDays}d (≤14d)`,
    };
  }

  if (diffDays <= customWindowDays) {
    return {
      level: 'due_soon',
      bucket: 'due_custom',
      daysRemaining: diffDays,
      effectiveDueDate: earliestDate,
      label: `Due in ${diffDays}d (≤${customWindowDays}d)`,
    };
  }

  return {
    level: 'healthy',
    bucket: 'healthy',
    daysRemaining: diffDays,
    effectiveDueDate: earliestDate,
    label: `Healthy (${diffDays}d left)`,
  };
}

/**
 * Strips all encrypted secret values and notes to produce the safe metadata projection
 * for the external SaaS Stack Tracker app and CSV/JSON metadata exports.
 */
export function toMetadataProjection(item: SecretItem): SecretMetadataProjection {
  return {
    id: item.id,
    label: item.label,
    product_name: item.product_name,
    service_name: item.service_name,
    secret_type: item.secret_type,
    environment: item.environment,
    status: item.status,
    last_rotated_date: item.last_rotated_date,
    next_rotation_due: item.next_rotation_due,
    expiry_date: item.expiry_date,
    deep_link: `/vault/api-keys/${encodeURIComponent(item.id)}`,
    updated_at: item.updated_at,
  };
}

/**
 * Exports metadata ONLY (never secret_value or notes) as CSV.
 */
export function exportSecretsMetadataToCsv(items: SecretItem[]): string {
  const headers = [
    'id',
    'label',
    'product_name',
    'service_name',
    'secret_type',
    'environment',
    'status',
    'created_date',
    'last_rotated_date',
    'rotation_interval_days',
    'next_rotation_due',
    'expiry_date',
    'login_url',
    'account_email',
    'username',
    'tags',
    'deep_link',
  ];

  const escapeCsvCell = (val: string | number | undefined) => {
    if (val === undefined || val === null) return '';
    const str = String(val);
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const rows = items.map((item) =>
    [
      item.id,
      item.label,
      item.product_name,
      item.service_name,
      item.secret_type,
      item.environment,
      item.status,
      item.created_date,
      item.last_rotated_date,
      item.rotation_interval_days ?? '',
      item.next_rotation_due ?? '',
      item.expiry_date ?? '',
      item.login_url ?? '',
      item.account_email ?? '',
      item.username ?? '',
      (item.tags || []).join(';'),
      `/vault/api-keys/${item.id}`,
    ]
      .map(escapeCsvCell)
      .join(',')
  );

  return [headers.join(','), ...rows].join('\n');
}

/**
 * Exports metadata ONLY (never secret_value or notes) as formatted JSON.
 */
export function exportSecretsMetadataToJson(items: SecretItem[]): string {
  return JSON.stringify(items.map(toMetadataProjection), null, 2);
}

/**
 * Bulk CSV Parser for Metadata ONLY.
 * Strictly ignores any secret_value or notes columns so secrets are never imported via plaintext CSV.
 */
export function parseSecretsMetadataCsv(csvText: string): Omit<SecretItem, 'secret_value_encrypted' | 'notes_encrypted'>[] {
  const lines = csvText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length < 2) return [];

  const splitRow = (row: string): string[] => {
    const out: string[] = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < row.length; i++) {
      const ch = row[i];
      if (ch === '"') {
        inQuotes = !inQuotes;
      } else if (ch === ',' && !inQuotes) {
        out.push(cur.trim());
        cur = '';
      } else {
        cur += ch;
      }
    }
    out.push(cur.trim());
    return out;
  };

  const headers = splitRow(lines[0]).map((h) => h.toLowerCase().replace(/\s+/g, '_'));
  const todayStr = new Date().toISOString().split('T')[0];
  const nowIso = new Date().toISOString();

  const results: Omit<SecretItem, 'secret_value_encrypted' | 'notes_encrypted'>[] = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = splitRow(lines[i]);
    const rowMap: Record<string, string> = {};
    headers.forEach((h, idx) => {
      rowMap[h] = cols[idx] || '';
    });

    const label = rowMap.label || rowMap.name;
    const product_name = rowMap.product_name || rowMap.product || 'Shared / all products';
    const service_name = rowMap.service_name || rowMap.service || 'External Service';

    if (!label) continue;

    const rawType = (rowMap.secret_type || rowMap.type || 'api_key').toLowerCase() as SecretType;
    const validTypes: SecretType[] = [
      'api_key',
      'password',
      'access_token',
      'recovery_code',
      'database_url',
      'webhook_secret',
      'ssh_key',
      'other',
    ];
    const secret_type: SecretType = validTypes.includes(rawType) ? rawType : 'api_key';

    const rawEnv = (rowMap.environment || rowMap.env || 'production').toLowerCase() as SecretEnvironment;
    const validEnvs: SecretEnvironment[] = ['dev', 'staging', 'production'];
    const environment: SecretEnvironment = validEnvs.includes(rawEnv) ? rawEnv : 'production';

    const rawStatus = (rowMap.status || 'active').toLowerCase() as SecretStatus;
    const validStatuses: SecretStatus[] = ['active', 'rotated', 'revoked', 'expired'];
    const status: SecretStatus = validStatuses.includes(rawStatus) ? rawStatus : 'active';

    const created_date = rowMap.created_date || todayStr;
    const last_rotated_date = rowMap.last_rotated_date || todayStr;
    const interval = parseInt(rowMap.rotation_interval_days || '90', 10);
    const rotation_interval_days = !isNaN(interval) && interval > 0 ? interval : 90;
    const next_rotation_due =
      rowMap.next_rotation_due || computeNextRotationDue(last_rotated_date, rotation_interval_days);

    results.push({
      id:
        rowMap.id ||
        `sec_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 7)}`,
      label,
      product_name,
      service_name,
      secret_type,
      environment,
      login_url: rowMap.login_url || undefined,
      account_email: rowMap.account_email || undefined,
      username: rowMap.username || undefined,
      created_date,
      last_rotated_date,
      rotation_interval_days,
      next_rotation_due,
      expiry_date: rowMap.expiry_date || undefined,
      status,
      tags: rowMap.tags
        ? rowMap.tags
            .split(/[;|]/)
            .map((t) => t.trim())
            .filter(Boolean)
        : [],
      rotation_history: [
        {
          id: `rot_${Date.now()}_${i}`,
          rotated_at: nowIso,
          note: 'Imported metadata via CSV (paste secret value via Rotate)',
        },
      ],
      created_at: nowIso,
      updated_at: nowIso,
    });
  }

  return results;
}

/**
 * Generates sample encrypted SaaS secrets when the user chooses "Load Demo Accounts / Secrets"
 */
export async function createDemoSecretItems(key: CryptoKey): Promise<SecretItem[]> {
  const now = new Date();
  const fmtDate = (offsetDays: number) => {
    const d = new Date(now);
    d.setUTCDate(d.getUTCDate() + offsetDays);
    return d.toISOString().split('T')[0];
  };

  const rawSamples: Array<{
    id: string;
    label: string;
    product_name: string;
    service_name: string;
    secret_type: SecretType;
    environment: SecretEnvironment;
    rawSecret: string;
    rawNotes: string;
    login_url: string;
    account_email: string;
    lastRotatedOffset: number;
    intervalDays: number;
    expiryOffset?: number;
    tags: string[];
  }> = [
    {
      id: 'sec_pharmacy_supabase_prod',
      label: 'Pharmacy DB Service Role Key',
      product_name: 'Pharmacy Management SaaS',
      service_name: 'Supabase',
      secret_type: 'api_key',
      environment: 'production',
      rawSecret: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.pharmacy_service_role_948201a',
      rawNotes: 'Used by Cloud Functions worker for prescription inventory sync.',
      login_url: 'https://supabase.com/dashboard',
      account_email: 'ops@founder-saas.io',
      lastRotatedOffset: -85,
      intervalDays: 90, // Due in 5 days!
      tags: ['database', 'critical', 'pharmacy'],
    },
    {
      id: 'sec_shared_telegram_bot',
      label: 'StackTrack Alert Bot Token',
      product_name: 'Shared / all products',
      service_name: 'Telegram Bot API',
      secret_type: 'access_token',
      environment: 'production',
      rawSecret: '7182940192:AAH9f8kL2mQpXzW0vBnM3cRtYuIoP4sDfGh',
      rawNotes: 'Shared Telegram webhook bot for instant SaaS outage & renewal alerts.',
      login_url: 'https://t.me/BotFather',
      account_email: 'alerts@founder-saas.io',
      lastRotatedOffset: -10,
      intervalDays: 180,
      tags: ['telegram', 'notifications', 'shared'],
    },
    {
      id: 'sec_restaurant_chapa_live',
      label: 'Chapa Live Webhook Secret',
      product_name: 'Restaurant & POS Cloud',
      service_name: 'Chapa Payment Gateway',
      secret_type: 'webhook_secret',
      environment: 'production',
      rawSecret: 'CHASECK_LIVE-9f8a7b6c5d4e3f2a1b0c9d8e7f6a5b4c',
      rawNotes: 'Verifies QR table order settlement webhooks.',
      login_url: 'https://dashboard.chapa.co',
      account_email: 'billing@founder-saas.io',
      lastRotatedOffset: -65,
      intervalDays: 60, // Overdue by 5 days!
      tags: ['payments', 'ethiopia', 'pos'],
    },
    {
      id: 'sec_minimarket_resend_prod',
      label: 'Transactional Email API Key',
      product_name: 'Minimarket ERP',
      service_name: 'Resend Email',
      secret_type: 'api_key',
      environment: 'production',
      rawSecret: 're_89fK2mP4xQ7vL1nZ3wC5bN8mJ0hG6fD',
      rawNotes: 'Sends daily Z-report receipts to store managers.',
      login_url: 'https://resend.com/api-keys',
      account_email: 'mail@founder-saas.io',
      lastRotatedOffset: -49,
      intervalDays: 60, // Due in 11 days!
      tags: ['email', 'minimarket'],
    },
  ];

  const items: SecretItem[] = [];
  for (const s of rawSamples) {
    const last_rotated_date = fmtDate(s.lastRotatedOffset);
    const next_rotation_due = computeNextRotationDue(last_rotated_date, s.intervalDays);
    const secret_value_encrypted = await encryptSecretString(s.rawSecret, key);
    const notes_encrypted = await encryptSecretString(s.rawNotes, key);

    items.push({
      id: s.id,
      label: s.label,
      product_name: s.product_name,
      service_name: s.service_name,
      secret_type: s.secret_type,
      environment: s.environment,
      secret_value_encrypted,
      notes_encrypted,
      login_url: s.login_url,
      account_email: s.account_email,
      created_date: fmtDate(-120),
      last_rotated_date,
      rotation_interval_days: s.intervalDays,
      next_rotation_due,
      expiry_date: s.expiryOffset ? fmtDate(s.expiryOffset) : undefined,
      status: 'active',
      tags: s.tags,
      rotation_history: [
        {
          id: `rot_${s.id}_init`,
          rotated_at: new Date(`${last_rotated_date}T09:00:00Z`).toISOString(),
          note: 'Initial production key provisioned',
        },
      ],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
  }

  return items;
}

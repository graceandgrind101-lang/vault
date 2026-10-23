/**
 * Krypton Vault - API Keys & Secrets Module Data Model
 * Stores AES-256-GCM client-encrypted secret values and notes with individual 12-byte IVs.
 * Exposes a strict metadata-only projection for the external SaaS Stack Tracker app.
 */

export type SecretType =
  | 'api_key'
  | 'password'
  | 'access_token'
  | 'recovery_code'
  | 'database_url'
  | 'webhook_secret'
  | 'ssh_key'
  | 'other';

export type SecretEnvironment = 'dev' | 'staging' | 'production';

export type SecretStatus = 'active' | 'rotated' | 'revoked' | 'expired';

export interface EncryptedFieldPayload {
  ciphertext: string; // Base64 AES-256-GCM ciphertext
  iv: string;         // Base64 12-byte random IV unique to this value
}

export interface SecretRotationHistoryEntry {
  id: string;
  rotated_at: string; // ISO timestamp
  note: string;       // Never contains the old secret value
}

export interface SecretItem {
  id: string; // Stable unique ID (e.g. sec_stripe_prod_9f8a) referenced by SaaS Tracker
  label: string;
  product_name: string; // e.g. "Pharmacy SaaS", "Restaurant POS", "Shared / all products"
  service_name: string; // e.g. "Stripe", "Telegram Bot API", "Supabase", "Cloudflare"
  secret_type: SecretType;
  environment: SecretEnvironment;

  // Client-side AES-256-GCM encrypted fields (each with its own 12-byte random IV)
  secret_value_encrypted?: EncryptedFieldPayload;
  notes_encrypted?: EncryptedFieldPayload;

  // Optional plain metadata
  login_url?: string;
  account_email?: string;
  username?: string;

  // Rotation & Expiry Lifecycle (YYYY-MM-DD)
  created_date: string;
  last_rotated_date: string;
  rotation_interval_days?: number; // e.g. 30, 60, 90, 180, 365, or custom
  next_rotation_due?: string;      // Computed: last_rotated_date + rotation_interval_days
  expiry_date?: string;            // Optional hard expiry date (YYYY-MM-DD)

  status: SecretStatus;
  tags: string[];
  rotation_history: SecretRotationHistoryEntry[];

  // Audit timestamps
  created_at: string;
  updated_at: string;
}

/**
 * Read-Only Metadata Projection exposed to the external SaaS Stack Tracker app.
 * NEVER includes secret_value_encrypted or notes_encrypted.
 */
export interface SecretMetadataProjection {
  id: string;
  label: string;
  product_name: string;
  service_name: string;
  secret_type: SecretType;
  environment: SecretEnvironment;
  status: SecretStatus;
  last_rotated_date: string;
  next_rotation_due?: string;
  expiry_date?: string;
  deep_link: string;
  updated_at: string;
}

export type SecretAuditAction =
  | 'reveal'
  | 'copy'
  | 'create'
  | 'edit'
  | 'rotate'
  | 'revoke'
  | 'delete'
  | 'token_created'
  | 'token_revoked'
  | 'csv_import'
  | 'metadata_export';

export interface SecretAuditLogEntry {
  id: string;
  timestamp: string;
  actor: string;
  action: SecretAuditAction;
  target_id?: string;
  target_label: string;
  details?: string; // Strictly non-sensitive description
}

export interface TrackerApiTokenRecord {
  id: string;
  label: string;
  tokenPreview: string; // e.g. "kv_ro_8f92...e1a4"
  scope: 'metadata:read';
  createdAt: string;
  lastUsedAt?: string;
  revoked: boolean;
}

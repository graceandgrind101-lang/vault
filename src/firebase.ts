import { initializeApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
  User,
} from 'firebase/auth';
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  getDocFromServer,
} from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';
import { SecretMetadataProjection, TrackerApiTokenRecord } from './types/secret';

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);
const googleProvider = new GoogleAuthProvider();
const TRACKER_FIRESTORE_DOC_ID = 'global_tracker_v1';

// Cloud API base URL used when running inside a standalone Capacitor Android APK (https://localhost)
const DEFAULT_CLOUD_API_ORIGIN =
  (import.meta as any).env?.VITE_API_BASE_URL ||
  'https://ais-pre-2jfrmum3h46oypmxygjbz3-427345422218.europe-west3.run.app';

export function resolveApiUrl(apiPath: string): string {
  if (typeof window === 'undefined') return apiPath;
  const isCapacitorLocal =
    window.location.protocol === 'capacitor:' ||
    window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1';
  // If running on port 3000 in local dev, keep relative path; in Capacitor Android WebView (port 80/443 on localhost), use cloud origin
  if (isCapacitorLocal && window.location.port !== '3000') {
    return `${DEFAULT_CLOUD_API_ORIGIN.replace(/\/$/, '')}${apiPath}`;
  }
  return apiPath;
}

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// Validate connection to Firestore on boot per skill requirements
async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
  }
}
testConnection();

export function sanitizeSyncChannelId(rawId: string): string {
  return rawId
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '-')
    .slice(0, 128);
}

export async function signInWithGoogleForVault(): Promise<User> {
  const credential = await signInWithPopup(auth, googleProvider);
  return credential.user;
}

export async function signOutFromVaultCloud(): Promise<void> {
  await signOut(auth);
}

export { onAuthStateChanged };
export type { User };

export interface FirestoreEncryptedVaultDoc {
  salt: string;
  iv: string;
  ciphertext: string;
  version: number;
  updatedAt: string;
}

/**
 * Pushes an AES-256-GCM encrypted vault snapshot to /vault_sync/{syncId} in Firestore.
 */
export async function pushFirestoreSyncChannel(
  rawSyncId: string,
  payload: { salt: string; iv: string; ciphertext: string }
): Promise<{ syncId: string; updatedAt: string }> {
  const syncId = sanitizeSyncChannelId(rawSyncId);
  if (syncId.length < 6) {
    throw new Error('Sync Vault ID must be at least 6 characters.');
  }
  const path = `vault_sync/${syncId}`;
  const updatedAt = new Date().toISOString().slice(0, 64);

  const docData = {
    syncId,
    salt: String(payload.salt).slice(0, 256),
    iv: String(payload.iv).slice(0, 256),
    ciphertext: String(payload.ciphertext).slice(0, 900000),
    version: 3,
    updatedAt,
  };

  try {
    await setDoc(doc(db, 'vault_sync', syncId), docData);
    return { syncId, updatedAt };
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

/**
 * Pulls an AES-256-GCM encrypted vault snapshot from /vault_sync/{syncId} in Firestore.
 */
export async function pullFirestoreSyncChannel(
  rawSyncId: string
): Promise<FirestoreEncryptedVaultDoc | null> {
  const syncId = sanitizeSyncChannelId(rawSyncId);
  if (syncId.length < 6) return null;
  const path = `vault_sync/${syncId}`;

  try {
    const snap = await getDoc(doc(db, 'vault_sync', syncId));
    if (!snap.exists()) return null;
    const data = snap.data();
    return {
      salt: String(data.salt || ''),
      iv: String(data.iv || ''),
      ciphertext: String(data.ciphertext || ''),
      version: Number(data.version || 3),
      updatedAt: String(data.updatedAt || ''),
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }
}

/**
 * Pushes an AES-256-GCM encrypted vault snapshot to /user_vaults/{uid} for the signed-in Google user.
 */
export async function pushAuthenticatedUserVault(payload: {
  salt: string;
  iv: string;
  ciphertext: string;
}): Promise<{ ownerId: string; updatedAtIso: string }> {
  const currentUser = auth.currentUser;
  if (!currentUser) {
    throw new Error('Sign in with Google first to sync with your personal cloud vault.');
  }
  const ownerId = currentUser.uid.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 128);
  const path = `user_vaults/${ownerId}`;
  const updatedAtIso = new Date().toISOString().slice(0, 64);

  const docData = {
    ownerId,
    salt: String(payload.salt).slice(0, 256),
    iv: String(payload.iv).slice(0, 256),
    ciphertext: String(payload.ciphertext).slice(0, 900000),
    version: 3,
    updatedAtIso,
  };

  try {
    await setDoc(doc(db, 'user_vaults', ownerId), docData);
    return { ownerId, updatedAtIso };
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

/**
 * Pulls an AES-256-GCM encrypted vault snapshot from /user_vaults/{uid} for the signed-in Google user.
 */
export async function pullAuthenticatedUserVault(): Promise<FirestoreEncryptedVaultDoc | null> {
  const currentUser = auth.currentUser;
  if (!currentUser) {
    throw new Error('Sign in with Google first to pull your personal cloud vault.');
  }
  const ownerId = currentUser.uid.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 128);
  const path = `user_vaults/${ownerId}`;

  try {
    const snap = await getDoc(doc(db, 'user_vaults', ownerId));
    if (!snap.exists()) return null;
    const data = snap.data();
    return {
      salt: String(data.salt || ''),
      iv: String(data.iv || ''),
      ciphertext: String(data.ciphertext || ''),
      version: Number(data.version || 3),
      updatedAt: String(data.updatedAtIso || ''),
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }
}

// ============================================================================
// DIRECT FIRESTORE SAAS TRACKER METADATA & TOKEN MANAGEMENT (Works in Standalone APK!)
// ============================================================================
async function sha256HexBrowser(input: string): Promise<string> {
  const encoded = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', encoded);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function randomHexBrowser(byteLength: number): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function readTrackerDocDirect(): Promise<{
  tokens: Array<TrackerApiTokenRecord & { tokenHash: string }>;
  items: SecretMetadataProjection[];
}> {
  const path = `tracker_store/${TRACKER_FIRESTORE_DOC_ID}`;
  try {
    const snap = await getDoc(doc(db, 'tracker_store', TRACKER_FIRESTORE_DOC_ID));
    if (snap.exists()) {
      const data = snap.data();
      return {
        tokens: Array.isArray(data.tokens) ? data.tokens : [],
        items: Array.isArray(data.items) ? data.items : [],
      };
    }
    return { tokens: [], items: [] };
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }
}

async function writeTrackerDocDirect(store: {
  tokens: Array<TrackerApiTokenRecord & { tokenHash: string }>;
  items: SecretMetadataProjection[];
}): Promise<void> {
  const path = `tracker_store/${TRACKER_FIRESTORE_DOC_ID}`;
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
    secret_type: i.secret_type,
    environment: i.environment,
    status: i.status,
    last_rotated_date: String(i.last_rotated_date),
    ...(i.next_rotation_due ? { next_rotation_due: String(i.next_rotation_due) } : {}),
    ...(i.expiry_date ? { expiry_date: String(i.expiry_date) } : {}),
    deep_link: String(i.deep_link),
    updated_at: String(i.updated_at),
  }));

  try {
    await setDoc(doc(db, 'tracker_store', TRACKER_FIRESTORE_DOC_ID), {
      storeId: TRACKER_FIRESTORE_DOC_ID,
      tokens: cleanTokens,
      items: cleanItems,
      updatedAt: new Date().toISOString().slice(0, 64),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function fetchTrackerTokensDirect(): Promise<TrackerApiTokenRecord[]> {
  const store = await readTrackerDocDirect();
  return store.tokens.map(({ tokenHash: _omit, ...rest }) => rest);
}

export async function createTrackerTokenDirect(
  label: string
): Promise<{ token: string; record: TrackerApiTokenRecord }> {
  const cleanLabel = (label || 'StackTrack Read-Only Token').trim().slice(0, 64);
  const rawToken = `kv_ro_${randomHexBrowser(24)}`;
  const tokenHash = await sha256HexBrowser(rawToken);
  const tokenPreview = `${rawToken.slice(0, 10)}...${rawToken.slice(-4)}`;

  const store = await readTrackerDocDirect();
  const newEntry = {
    id: `tok_${Date.now()}_${randomHexBrowser(3)}`,
    label: cleanLabel,
    tokenHash,
    tokenPreview,
    scope: 'metadata:read' as const,
    createdAt: new Date().toISOString(),
    revoked: false,
  };
  store.tokens.unshift(newEntry);
  await writeTrackerDocDirect(store);

  const { tokenHash: _omit, ...safeRecord } = newEntry;
  return { token: rawToken, record: safeRecord };
}

export async function revokeTrackerTokenDirect(tokenId: string): Promise<boolean> {
  const store = await readTrackerDocDirect();
  const target = store.tokens.find((t) => t.id === tokenId);
  if (!target) return false;
  target.revoked = true;
  await writeTrackerDocDirect(store);
  return true;
}

export async function syncTrackerMetadataDirect(
  items: SecretMetadataProjection[]
): Promise<void> {
  const store = await readTrackerDocDirect();
  store.items = items.slice(0, 500);
  await writeTrackerDocDirect(store);
}

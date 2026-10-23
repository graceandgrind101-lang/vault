import React, { useState, useEffect } from 'react';
import {
  ShieldCheck,
  AlertTriangle,
  Download,
  Upload,
  Clock,
  FileKey,
  CloudUpload,
  CloudDownload,
  Database,
  Smartphone,
  Fingerprint,
  Grid,
  Check,
  Copy,
  Loader2,
  EyeOff,
  LogOut,
  UserCheck,
} from 'lucide-react';
import { AccountRecord, SupportedLanguage, VaultSecurityConfig } from '../types/account';
import { auditPinStrength } from '../utils/validator';
import { translations } from '../utils/i18n';
import {
  hasQuickPinConfigured,
  setupQuickPin,
  clearQuickPin,
  hasBiometricPasskeyEnrolled,
  registerBiometricPasskey,
  clearBiometricPasskey,
} from '../utils/crypto';
import {
  auth,
  onAuthStateChanged,
  signInWithGoogleForVault,
  signOutFromVaultCloud,
  User,
} from '../firebase';

interface SecurityAuditViewProps {
  accounts: AccountRecord[];
  securityConfig: VaultSecurityConfig;
  onUpdateSecurityConfig: (config: VaultSecurityConfig) => void;
  onExportBackup: () => void;
  onImportBackup: (jsonContent: string, passphrase?: string) => Promise<boolean>;
  onPushCloudSync: (syncId: string) => Promise<boolean>;
  onPullCloudSync: (syncId: string, passphrase?: string) => Promise<boolean>;
  onLoadDemoAccounts: () => void;
  currentLanguage: SupportedLanguage;
}

export const SecurityAuditView: React.FC<SecurityAuditViewProps> = ({
  accounts,
  securityConfig,
  onUpdateSecurityConfig,
  onExportBackup,
  onImportBackup,
  onPushCloudSync,
  onPullCloudSync,
  onLoadDemoAccounts,
  currentLanguage,
}) => {
  const t = translations[currentLanguage];
  const [importStatus, setImportStatus] = useState<string | null>(null);
  const [pendingBackupJson, setPendingBackupJson] = useState<string | null>(null);
  const [backupPassphraseInput, setBackupPassphraseInput] = useState('');
  const [isRestoring, setIsRestoring] = useState(false);

  // Cloud Sync & Firebase Auth State
  const [syncIdInput, setSyncIdInput] = useState(securityConfig.syncVaultId || '');
  const [syncPassphraseInput, setSyncPassphraseInput] = useState('');
  const [showSyncPullPrompt, setShowSyncPullPrompt] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncFeedback, setSyncFeedback] = useState<string | null>(null);
  const [firebaseUser, setFirebaseUser] = useState<User | null>(auth.currentUser);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      setFirebaseUser(user);
      if (user && !syncIdInput) {
        const defaultChannel = `vault-${user.uid.slice(0, 12).toLowerCase()}`;
        setSyncIdInput(defaultChannel);
      }
    });
    return () => unsub();
  }, [syncIdInput]);

  // Quick PIN & Biometrics Enrollment State
  const [pinConfigured, setPinConfigured] = useState(hasQuickPinConfigured());
  const [bioConfigured, setBioConfigured] = useState(hasBiometricPasskeyEnrolled());
  const [newQuickPin, setNewQuickPin] = useState('');
  const [currentMasterForPin, setCurrentMasterForPin] = useState('');
  const [showPinSetup, setShowPinSetup] = useState(false);
  const [pinSetupNotice, setPinSetupNotice] = useState<string | null>(null);
  const [copiedCapCmd, setCopiedCapCmd] = useState(false);

  // 1. Audit PINs
  const pinAudits = accounts.map((acc) => {
    const atmAudit = acc.atm?.hasAtm ? auditPinStrength(acc.atm.atmPin) : null;
    const mobileAudit = acc.mobileBanking?.hasMobileBanking
      ? auditPinStrength(acc.mobileBanking.mobileBankingPin)
      : null;
    return {
      acc,
      atmAudit,
      mobileAudit,
    };
  });

  const weakPinCount = pinAudits.filter(
    (a) => (a.atmAudit && a.atmAudit.score <= 2) || (a.mobileAudit && a.mobileAudit.score <= 2)
  ).length;

  // 2. Audit Reused PINs
  const pinOccurrences: Record<string, string[]> = {};
  accounts.forEach((acc) => {
    if (acc.atm?.hasAtm && acc.atm.atmPin) {
      pinOccurrences[acc.atm.atmPin] = pinOccurrences[acc.atm.atmPin] || [];
      pinOccurrences[acc.atm.atmPin].push(`${acc.name} (ATM)`);
    }
    if (acc.mobileBanking?.hasMobileBanking && acc.mobileBanking.mobileBankingPin) {
      pinOccurrences[acc.mobileBanking.mobileBankingPin] =
        pinOccurrences[acc.mobileBanking.mobileBankingPin] || [];
      pinOccurrences[acc.mobileBanking.mobileBankingPin].push(`${acc.name} (Mobile)`);
    }
  });

  const sharedPins = Object.entries(pinOccurrences).filter(
    ([, accountsList]) => accountsList.length > 1
  );

  // Overall Health Score (0 - 100)
  let healthScore = 100;
  if (weakPinCount > 0) healthScore -= weakPinCount * 15;
  if (sharedPins.length > 0) healthScore -= sharedPins.length * 20;
  healthScore = Math.max(20, Math.min(100, healthScore));

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (event) => {
      const text = event.target?.result as string;
      if (!text) return;
      // Try decrypting with active session key first, else prompt for backup passphrase
      const immediateOk = await onImportBackup(text);
      if (immediateOk) {
        setImportStatus('Encrypted backup decrypted and restored!');
      } else {
        setPendingBackupJson(text);
        setImportStatus('Enter the Master Passphrase used when creating this backup file.');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleConfirmBackupRestore = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pendingBackupJson || !backupPassphraseInput) return;
    setIsRestoring(true);
    try {
      const ok = await onImportBackup(pendingBackupJson, backupPassphraseInput);
      if (ok) {
        setImportStatus('Backup decrypted and restored successfully!');
        setPendingBackupJson(null);
        setBackupPassphraseInput('');
      } else {
        setImportStatus('Decryption failed: Incorrect Master Passphrase for this backup.');
      }
    } finally {
      setIsRestoring(false);
    }
  };

  const handleGoogleSignIn = async () => {
    try {
      const user = await signInWithGoogleForVault();
      const channel = `vault-${user.uid.slice(0, 12).toLowerCase()}`;
      if (!syncIdInput) setSyncIdInput(channel);
      setSyncFeedback(`Signed in as ${user.email}. Ready for permanent Firestore Cloud Sync!`);
    } catch (err: any) {
      setSyncFeedback(err.message || 'Google Sign-In cancelled.');
    }
  };

  const handleGoogleSignOut = async () => {
    await signOutFromVaultCloud();
    setSyncFeedback('Signed out of Google Cloud session.');
  };

  const handleCloudPush = async () => {
    if (!syncIdInput || syncIdInput.trim().length < 6) {
      setSyncFeedback('Choose a Sync Vault ID of at least 6 characters.');
      return;
    }
    setIsSyncing(true);
    setSyncFeedback(null);
    try {
      const ok = await onPushCloudSync(syncIdInput.trim());
      if (ok) {
        setSyncFeedback('Zero-knowledge AES-256-GCM snapshot permanently saved to Firebase Firestore!');
      } else {
        setSyncFeedback('Cloud sync failed. Ensure vault is unlocked.');
      }
    } finally {
      setIsSyncing(false);
    }
  };

  const handleCloudPull = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!syncIdInput || syncIdInput.trim().length < 6) {
      setSyncFeedback('Enter your Sync Vault ID (min 6 chars) to pull backup.');
      return;
    }
    setIsSyncing(true);
    setSyncFeedback(null);
    try {
      const ok = await onPullCloudSync(
        syncIdInput.trim(),
        syncPassphraseInput ? syncPassphraseInput : undefined
      );
      if (ok) {
        setSyncFeedback('Cloud vault pulled from Firebase Firestore, decrypted, and restored!');
        setShowSyncPullPrompt(false);
        setSyncPassphraseInput('');
      } else {
        setShowSyncPullPrompt(true);
        setSyncFeedback('Enter the Master Passphrase for this Cloud Sync Vault to decrypt.');
      }
    } finally {
      setIsSyncing(false);
    }
  };

  const handleConfigurePinAndBio = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentMasterForPin) {
      setPinSetupNotice('Please enter your Master Passphrase to authorize key wrapping.');
      return;
    }
    try {
      if (newQuickPin) {
        if (!/^\d{6}$/.test(newQuickPin)) {
          setPinSetupNotice('Quick PIN must be exactly 6 numeric digits.');
          return;
        }
        await setupQuickPin(newQuickPin, currentMasterForPin);
        setPinConfigured(true);
      }
      await registerBiometricPasskey(currentMasterForPin);
      setBioConfigured(true);
      setPinSetupNotice('6-Digit Quick PIN & Biometric Passkey paired with your Master Key!');
      setNewQuickPin('');
      setCurrentMasterForPin('');
      setShowPinSetup(false);
    } catch (err: any) {
      setPinSetupNotice(err.message || 'Failed to configure Quick PIN.');
    }
  };

  return (
    <div className="space-y-6 pb-20">
      {/* Top Banner / Audit Score */}
      <div className="p-5 rounded-3xl bg-gradient-to-br from-[#0e172a] via-[#091120] to-[#040810] border border-slate-800 relative overflow-hidden">
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <span className="text-[10px] font-mono tracking-widest text-emerald-400">
              Zero-Knowledge Vault Guard
            </span>
            <h3 className="text-xl font-bold text-slate-100">{t.securityAudit}</h3>
            <p className="text-xs text-slate-400 max-w-sm">
              Continuous client-side cryptographic analysis of PIN entropy, credential reuse, and full-vault AES-256-GCM encryption at rest.
            </p>
          </div>
          {/* Health Score Circle */}
          <div className="relative w-20 h-20 flex items-center justify-center shrink-0">
            <svg className="w-full h-full transform -rotate-90">
              <circle
                cx="40"
                cy="40"
                r="32"
                stroke="currentColor"
                strokeWidth="6"
                className="text-slate-800"
                fill="transparent"
              />
              <circle
                cx="40"
                cy="40"
                r="32"
                stroke="currentColor"
                strokeWidth="6"
                strokeDasharray={200}
                strokeDashoffset={200 - (200 * healthScore) / 100}
                strokeLinecap="round"
                className={
                  healthScore >= 80
                    ? 'text-emerald-400'
                    : healthScore >= 60
                    ? 'text-amber-400'
                    : 'text-rose-500'
                }
                fill="transparent"
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-lg font-extrabold font-mono text-slate-100 tabular-nums">
                {healthScore}
              </span>
              <span className="text-[9px] font-mono text-slate-400">/ 100</span>
            </div>
          </div>
        </div>

        {/* Audit metrics row */}
        <div className="grid grid-cols-3 gap-2 mt-4 pt-4 border-t border-slate-800/80 text-center">
          <div className="p-2 rounded-xl bg-slate-900/60 border border-slate-800">
            <p className="text-[10px] font-mono text-slate-400">Encrypted Records</p>
            <p className="text-base font-bold font-mono text-slate-100 tabular-nums">
              {accounts.length}
            </p>
          </div>
          <div className="p-2 rounded-xl bg-slate-900/60 border border-slate-800">
            <p className="text-[10px] font-mono text-slate-400">Weak PINs</p>
            <p
              className={`text-base font-bold font-mono tabular-nums ${
                weakPinCount > 0 ? 'text-amber-400' : 'text-emerald-400'
              }`}
            >
              {weakPinCount}
            </p>
          </div>
          <div className="p-2 rounded-xl bg-slate-900/60 border border-slate-800">
            <p className="text-[10px] font-mono text-slate-400">Reused PINs</p>
            <p
              className={`text-base font-bold font-mono tabular-nums ${
                sharedPins.length > 0 ? 'text-rose-400' : 'text-emerald-400'
              }`}
            >
              {sharedPins.length}
            </p>
          </div>
        </div>
      </div>

      {/* Security Alerts List */}
      {(weakPinCount > 0 || sharedPins.length > 0) && (
        <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/20 space-y-2">
          <div className="flex items-center gap-2 text-amber-400 font-semibold text-xs">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>Security Recommendations Detected</span>
          </div>
          <ul className="text-xs text-slate-300 space-y-1.5 list-disc list-inside">
            {weakPinCount > 0 && (
              <li>
                {weakPinCount} account(s) use simple sequential or repetitive PINs (e.g. 1234, 0000). We recommend updating to 6-digit random PINs.
              </li>
            )}
            {sharedPins.map(([, list], idx) => (
              <li key={idx}>
                Credential reuse: The same PIN is used across multiple accounts: {list.join(', ')}.
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ================= ZERO-KNOWLEDGE ENCRYPTED CLOUD SYNC (FIREBASE FIRESTORE) ================= */}
      <div className="p-5 rounded-2xl bg-[#0c1220] border border-slate-800 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <CloudUpload className="w-4 h-4 text-emerald-400" />
            <h4 className="text-xs font-bold text-slate-200 font-mono">
              Permanent Cloud Sync (Firebase Firestore AES-256-GCM)
            </h4>
          </div>
          <div className="flex items-center gap-2">
            <span className="px-2 py-0.5 rounded-md bg-emerald-500/15 border border-emerald-500/30 text-[10px] font-mono text-emerald-300">
              Firestore Active
            </span>
            {securityConfig.lastSyncedAt && (
              <span className="text-[10px] font-mono text-slate-400">
                Last synced: {new Date(securityConfig.lastSyncedAt).toLocaleTimeString()}
              </span>
            )}
          </div>
        </div>

        <p className="text-xs text-slate-400">
          Your encrypted vault (Accounts, Cards, API Keys &amp; Secrets, and Ledger) is backed by permanent <strong>Firebase Firestore</strong> storage. Only AES-256-GCM ciphertext is stored in the cloud—your Master Passphrase never leaves your device.
        </p>

        {/* Optional Google Account Identity Binding */}
        <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-xs">
            <UserCheck className="w-4 h-4 text-emerald-400 shrink-0" />
            {firebaseUser ? (
              <div>
                <p className="font-semibold text-slate-200">
                  Linked Google Cloud Identity: <span className="text-emerald-400">{firebaseUser.email}</span>
                </p>
                <p className="text-[10px] text-slate-400 font-mono">
                  UID Vault: /user_vaults/{firebaseUser.uid.slice(0, 10)}...
                </p>
              </div>
            ) : (
              <div>
                <p className="font-semibold text-slate-200">Optional: Bind to Google Account</p>
                <p className="text-[10px] text-slate-400">
                  Sign in with Google to bind your encrypted Firestore backup to your verified Google UID
                </p>
              </div>
            )}
          </div>

          {firebaseUser ? (
            <button
              type="button"
              onClick={handleGoogleSignOut}
              className="px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700 text-[11px] font-medium text-slate-300 flex items-center gap-1.5"
            >
              <LogOut className="w-3.5 h-3.5 text-rose-400" />
              <span>Sign Out</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={handleGoogleSignIn}
              className="px-3 py-1.5 rounded-lg bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/30 text-[11px] font-semibold text-emerald-300 flex items-center gap-1.5"
            >
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>Connect Google Account</span>
            </button>
          )}
        </div>

        <div className="flex flex-col sm:flex-row gap-2.5">
          <input
            type="text"
            value={syncIdInput}
            onChange={(e) => setSyncIdInput(e.target.value)}
            placeholder="Enter a unique Sync Vault ID (e.g. krypton-abebe-2026)"
            className="flex-1 h-11 px-3.5 rounded-xl bg-slate-950 border border-slate-800 text-xs font-mono text-slate-100 placeholder-slate-500 focus:outline-none focus:border-emerald-500"
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleCloudPush}
              disabled={isSyncing}
              className="h-11 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors disabled:opacity-50"
            >
              {isSyncing ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <CloudUpload className="w-4 h-4" />
              )}
              <span>Push to Firestore</span>
            </button>
            <button
              type="button"
              onClick={() => handleCloudPull()}
              disabled={isSyncing}
              className="h-11 px-4 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-200 text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors disabled:opacity-50"
            >
              <CloudDownload className="w-4 h-4 text-cyan-400" />
              <span>Pull from Firestore</span>
            </button>
          </div>
        </div>

        {showSyncPullPrompt && (
          <form
            onSubmit={handleCloudPull}
            className="p-3.5 rounded-xl bg-slate-950 border border-emerald-500/30 space-y-2.5 animate-fade-in"
          >
            <label className="block text-xs font-medium text-slate-200">
              Enter Master Passphrase for Cloud Vault <span className="font-mono text-emerald-400">{syncIdInput}</span>:
            </label>
            <div className="flex gap-2">
              <input
                type="password"
                required
                value={syncPassphraseInput}
                onChange={(e) => setSyncPassphraseInput(e.target.value)}
                placeholder="Master Passphrase used when pushing..."
                className="flex-1 h-10 px-3 rounded-lg bg-slate-900 border border-slate-700 text-xs text-slate-100 focus:outline-none focus:border-emerald-500"
              />
              <button
                type="submit"
                disabled={isSyncing}
                className="px-4 h-10 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold"
              >
                Decrypt & Restore
              </button>
            </div>
          </form>
        )}

        {syncFeedback && (
          <p className="text-xs text-emerald-400 font-medium p-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
            {syncFeedback}
          </p>
        )}
      </div>

      {/* ================= BIOMETRIC & 6-DIGIT QUICK PIN LOCK SETTINGS ================= */}
      <div className="p-5 rounded-2xl bg-[#0c1220] border border-slate-800 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Fingerprint className="w-4 h-4 text-emerald-400" />
            <h4 className="text-xs font-bold text-slate-200 font-mono">
              6-Digit Keypad PIN & Hardware Biometrics
            </h4>
          </div>
          <button
            type="button"
            onClick={() => setShowPinSetup(!showPinSetup)}
            className="px-3 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-700 text-xs font-semibold text-emerald-400"
          >
            {showPinSetup ? 'Cancel' : 'Configure PIN / Biometrics'}
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
          <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Grid className="w-4 h-4 text-emerald-400" />
              <div>
                <p className="font-semibold text-slate-200">6-Digit Mobile Keypad</p>
                <p className="text-[10px] text-slate-400">
                  {pinConfigured ? 'Active (PBKDF2 wrapped)' : 'Not configured'}
                </p>
              </div>
            </div>
            {pinConfigured && (
              <button
                type="button"
                onClick={() => {
                  clearQuickPin();
                  setPinConfigured(false);
                }}
                className="text-[11px] text-rose-400 hover:underline"
              >
                Remove
              </button>
            )}
          </div>

          <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Fingerprint className="w-4 h-4 text-emerald-400" />
              <div>
                <p className="font-semibold text-slate-200">WebAuthn / Android Biometrics</p>
                <p className="text-[10px] text-slate-400">
                  {bioConfigured ? 'Hardware Key Paired' : 'Not paired yet'}
                </p>
              </div>
            </div>
            {bioConfigured && (
              <button
                type="button"
                onClick={() => {
                  clearBiometricPasskey();
                  setBioConfigured(false);
                }}
                className="text-[11px] text-rose-400 hover:underline"
              >
                Unpair
              </button>
            )}
          </div>
        </div>

        {showPinSetup && (
          <form
            onSubmit={handleConfigurePinAndBio}
            className="p-4 rounded-2xl bg-slate-950 border border-slate-800 space-y-3 animate-fade-in"
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  New 6-Digit Quick PIN
                </label>
                <input
                  type="password"
                  inputMode="numeric"
                  maxLength={6}
                  value={newQuickPin}
                  onChange={(e) => setNewQuickPin(e.target.value.replace(/\D/g, ''))}
                  placeholder="6 digits (e.g. 482910)"
                  className="w-full h-10 px-3 rounded-xl bg-slate-900 border border-slate-700 text-xs font-mono tracking-widest text-slate-100 focus:outline-none focus:border-emerald-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Confirm Current Master Passphrase *
                </label>
                <input
                  type="password"
                  required
                  value={currentMasterForPin}
                  onChange={(e) => setCurrentMasterForPin(e.target.value)}
                  placeholder="Enter Master Passphrase to wrap key..."
                  className="w-full h-10 px-3 rounded-xl bg-slate-900 border border-slate-700 text-xs text-slate-100 focus:outline-none focus:border-emerald-500"
                />
              </div>
            </div>
            <div className="flex justify-end">
              <button
                type="submit"
                className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold"
              >
                Save Quick PIN & Pair Biometrics
              </button>
            </div>
          </form>
        )}

        {pinSetupNotice && (
          <p className="text-xs text-emerald-400 font-medium">{pinSetupNotice}</p>
        )}
      </div>

      {/* ================= AUTO-LOCK & SCREEN-BLUR PRIVACY SHIELD ================= */}
      <div className="p-5 rounded-2xl bg-[#0c1220] border border-slate-800 space-y-4">
        <div className="flex items-center gap-2">
          <Clock className="w-4 h-4 text-emerald-400" />
          <h4 className="text-xs font-bold text-slate-200 font-mono">
            Auto-Lock & Screen-Blur Privacy Protection
          </h4>
        </div>

        <div>
          <label className="block text-xs text-slate-400 mb-2">
            Automatically lock the vault and flush decrypted keys from memory after inactivity:
          </label>
          <div className="grid grid-cols-4 gap-2">
            {[1, 5, 15, 0].map((mins) => (
              <button
                key={mins}
                type="button"
                onClick={() =>
                  onUpdateSecurityConfig({ ...securityConfig, autoLockMinutes: mins })
                }
                className={`py-2 px-3 rounded-xl text-xs font-semibold font-mono transition-all ${
                  securityConfig.autoLockMinutes === mins
                    ? 'bg-emerald-600 text-white shadow-md shadow-emerald-950'
                    : 'bg-slate-900 border border-slate-800 text-slate-400 hover:text-white'
                }`}
              >
                {mins === 0 ? 'Never' : `${mins} min`}
              </button>
            ))}
          </div>
        </div>

        {/* Screen Blur on App Switch */}
        <div className="flex items-center justify-between pt-3 border-t border-slate-800/80">
          <div className="pr-3">
            <p className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
              <EyeOff className="w-3.5 h-3.5 text-emerald-400" />
              Screen-Blur Privacy Shield (Anti-Screenshot / App Switcher)
            </p>
            <p className="text-[10px] text-slate-400">
              Blurs the viewport immediately when switching tabs or minimizing the app on Android/Web
            </p>
          </div>
          <label className="relative inline-flex items-center cursor-pointer shrink-0">
            <input
              type="checkbox"
              checked={securityConfig.hideScreenOnSwitch}
              onChange={(e) =>
                onUpdateSecurityConfig({
                  ...securityConfig,
                  hideScreenOnSwitch: e.target.checked,
                })
              }
              className="sr-only peer"
            />
            <div className="w-11 h-6 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-600"></div>
          </label>
        </div>

        {/* Lock on Tab Switch */}
        <div className="flex items-center justify-between pt-3 border-t border-slate-800/80">
          <div className="pr-3">
            <p className="text-xs font-semibold text-slate-200">Strict Lock On Tab Switch</p>
            <p className="text-[10px] text-slate-400">
              Require Master Passphrase / PIN immediately if the app window loses focus
            </p>
          </div>
          <label className="relative inline-flex items-center cursor-pointer shrink-0">
            <input
              type="checkbox"
              checked={securityConfig.lockOnTabSwitch}
              onChange={(e) =>
                onUpdateSecurityConfig({
                  ...securityConfig,
                  lockOnTabSwitch: e.target.checked,
                })
              }
              className="sr-only peer"
            />
            <div className="w-11 h-6 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-600"></div>
          </label>
        </div>
      </div>

      {/* ================= LOCAL FILE BACKUP & SANDBOX DEMO DATA ================= */}
      <div className="p-5 rounded-2xl bg-[#0c1220] border border-slate-800 space-y-4">
        <div className="flex items-center gap-2">
          <FileKey className="w-4 h-4 text-emerald-400" />
          <h4 className="text-xs font-bold text-slate-200 font-mono">
            Offline File Backup & Demo Sandbox
          </h4>
        </div>
        <p className="text-xs text-slate-400">
          Export your entire vault as an AES-256-GCM encrypted JSON file, restore from an existing backup file, or load sample accounts for testing.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-1">
          <button
            type="button"
            onClick={onExportBackup}
            className="flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-700/80 text-slate-200 text-xs font-semibold transition-colors"
          >
            <Download className="w-4 h-4 text-emerald-400" />
            <span>{t.emergencyExport}</span>
          </button>

          <label className="flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-700/80 text-slate-200 text-xs font-semibold transition-colors cursor-pointer">
            <Upload className="w-4 h-4 text-cyan-400" />
            <span>{t.importVault}</span>
            <input
              type="file"
              accept=".json"
              onChange={handleFileChange}
              className="hidden"
            />
          </label>

          <button
            type="button"
            onClick={onLoadDemoAccounts}
            className="flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-700/80 text-slate-200 text-xs font-semibold transition-colors"
          >
            <Database className="w-4 h-4 text-amber-400" />
            <span>Load Demo Accounts</span>
          </button>
        </div>

        {/* Passphrase Prompt Modal when restoring a backup encrypted with a different passphrase */}
        {pendingBackupJson && (
          <form
            onSubmit={handleConfirmBackupRestore}
            className="p-4 rounded-2xl bg-slate-950 border border-emerald-500/40 space-y-3 animate-fade-in"
          >
            <p className="text-xs font-semibold text-slate-200">
              Decrypt Backup File
            </p>
            <p className="text-[11px] text-slate-400">
              Enter the Master Passphrase that was active when this backup file was exported:
            </p>
            <div className="flex gap-2">
              <input
                type="password"
                required
                value={backupPassphraseInput}
                onChange={(e) => setBackupPassphraseInput(e.target.value)}
                placeholder="Backup Master Passphrase..."
                className="flex-1 h-10 px-3 rounded-xl bg-slate-900 border border-slate-700 text-xs text-slate-100 focus:outline-none focus:border-emerald-500"
              />
              <button
                type="submit"
                disabled={isRestoring}
                className="px-4 h-10 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold"
              >
                {isRestoring ? 'Decrypting...' : 'Unlock Backup'}
              </button>
              <button
                type="button"
                onClick={() => setPendingBackupJson(null)}
                className="px-3 h-10 rounded-xl border border-slate-700 text-xs text-slate-400"
              >
                Cancel
              </button>
            </div>
          </form>
        )}

        {importStatus && (
          <p className="text-xs text-emerald-400 font-medium p-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-center">
            {importStatus}
          </p>
        )}
      </div>

      {/* ================= CAPACITOR NATIVE ANDROID APK/AAB PACKAGING ================= */}
      <div className="p-5 rounded-2xl bg-[#070b14] border border-slate-800/80 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-slate-200">
            <Smartphone className="w-4 h-4 text-emerald-400" />
            <span className="text-xs font-bold font-mono">
              Capacitor Native Android Packaging (APK / AAB)
            </span>
          </div>
          <button
            type="button"
            onClick={() => {
              navigator.clipboard?.writeText(
                'npm install @capacitor/core @capacitor/cli @capacitor/android && npx cap add android && npm run android:sync && npm run android:open'
              );
              setCopiedCapCmd(true);
              setTimeout(() => setCopiedCapCmd(false), 2000);
            }}
            className="text-[11px] font-mono text-emerald-400 hover:text-emerald-300 flex items-center gap-1"
          >
            {copiedCapCmd ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
            <span>{copiedCapCmd ? 'Copied CLI' : 'Copy Build Command'}</span>
          </button>
        </div>
        <p className="text-xs text-slate-400">
          Configured in <code className="text-emerald-300 font-mono">capacitor.config.ts</code> with App ID <code className="text-slate-300 font-mono">com.kryptonvault.zeroknowledge</code>, <code className="text-slate-300 font-mono">FLAG_SECURE</code> screenshot blocking, and Android Hardware Biometric Keystore.
        </p>
        <div className="text-[11px] text-slate-400 space-y-1 font-mono bg-slate-950 p-3 rounded-xl border border-slate-800/80">
          <p>1. npm install @capacitor/core @capacitor/cli @capacitor/android</p>
          <p>2. npx cap add android</p>
          <p>3. npm run android:sync &amp;&amp; npm run android:open</p>
        </div>
      </div>
    </div>
  );
};

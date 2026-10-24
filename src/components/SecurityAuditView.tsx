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
  Trash2,
  Share2,
  ClipboardPaste,
  Info,
  Mail,
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
  getLinkedCloudIdentity,
  bindDirectCloudIdentity,
  LinkedCloudIdentity,
  User,
} from '../firebase';

interface SecurityAuditViewProps {
  accounts: AccountRecord[];
  securityConfig: VaultSecurityConfig;
  onUpdateSecurityConfig: (config: VaultSecurityConfig) => void;
  onExportBackup: () => Promise<{ json: string; filename: string } | null>;
  onImportBackup: (jsonContent: string, passphrase?: string) => Promise<boolean>;
  onPushCloudSync: (syncId: string) => Promise<boolean>;
  onPullCloudSync: (syncId: string, passphrase?: string) => Promise<boolean>;
  onLoadDemoAccounts: () => void;
  onClearDemoData?: () => void;
  hasDemoData?: boolean;
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
  onClearDemoData,
  hasDemoData,
  currentLanguage,
}) => {
  const t = translations[currentLanguage];
  const [importStatus, setImportStatus] = useState<string | null>(null);
  const [pendingBackupJson, setPendingBackupJson] = useState<string | null>(null);
  const [backupPassphraseInput, setBackupPassphraseInput] = useState('');
  const [isRestoring, setIsRestoring] = useState(false);

  // Offline Backup Export & Paste Restore Drawer State (for Standalone Android APK & Web)
  const [exportedBackupData, setExportedBackupData] = useState<{
    json: string;
    filename: string;
  } | null>(null);
  const [copiedBackupJson, setCopiedBackupJson] = useState(false);
  const [showPasteRestoreModal, setShowPasteRestoreModal] = useState(false);
  const [pastedBackupText, setPastedBackupText] = useState('');

  // Cloud Sync & Firebase Identity State
  const [linkedIdentity, setLinkedIdentity] = useState<LinkedCloudIdentity | null>(() =>
    getLinkedCloudIdentity()
  );
  const [syncIdInput, setSyncIdInput] = useState(
    securityConfig.syncVaultId || getLinkedCloudIdentity()?.vaultChannelId || ''
  );
  const [syncPassphraseInput, setSyncPassphraseInput] = useState('');
  const [showSyncPullPrompt, setShowSyncPullPrompt] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncFeedback, setSyncFeedback] = useState<string | null>(null);
  const [firebaseUser, setFirebaseUser] = useState<User | null>(auth.currentUser);
  const [showDirectEmailBind, setShowDirectEmailBind] = useState(false);
  const [directEmailInput, setDirectEmailInput] = useState('');

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

  // Trigger Export Backup and open Android/Web Export Drawer
  const handleTriggerExport = async () => {
    setImportStatus(null);
    const result = await onExportBackup();
    if (result) {
      setExportedBackupData(result);
    }
  };

  // Share or Save Backup File natively on Android via Web Share API
  const handleNativeShareBackup = async () => {
    if (!exportedBackupData) return;
    try {
      const file = new File([exportedBackupData.json], exportedBackupData.filename, {
        type: 'application/json',
      });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({
          title: 'Krypton Vault Encrypted Backup',
          text: 'AES-256-GCM Zero-Knowledge Encrypted Vault Backup (.json)',
          files: [file],
        });
        setImportStatus('Backup file shared / saved via system share sheet.');
        return;
      }
      if (navigator.share) {
        await navigator.share({
          title: exportedBackupData.filename,
          text: exportedBackupData.json,
        });
        setImportStatus('Encrypted backup shared via Android share sheet.');
        return;
      }
    } catch {
      // User dismissed share sheet or share API unavailable, fallback to copy
    }
    await handleCopyBackupJson();
  };

  const handleCopyBackupJson = async () => {
    if (!exportedBackupData) return;
    try {
      await navigator.clipboard.writeText(exportedBackupData.json);
      setCopiedBackupJson(true);
      setImportStatus('Encrypted backup JSON copied to clipboard! Paste it into Notes, Telegram, or Google Drive.');
      setTimeout(() => setCopiedBackupJson(false), 2500);
    } catch {
      setImportStatus('Select and copy the encrypted JSON text below.');
    }
  };

  const processIncomingBackupText = async (rawText: string) => {
    const trimmed = rawText.trim();
    if (!trimmed) return;
    const immediateOk = await onImportBackup(trimmed);
    if (immediateOk) {
      setImportStatus('Encrypted backup decrypted and restored into your vault!');
      setShowPasteRestoreModal(false);
      setPastedBackupText('');
      setPendingBackupJson(null);
    } else {
      setPendingBackupJson(trimmed);
      setShowPasteRestoreModal(false);
      setImportStatus('Backup file loaded! Enter the Master Passphrase used when creating this backup to decrypt it.');
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (event) => {
      const text = event.target?.result as string;
      if (!text) return;
      await processIncomingBackupText(text);
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handlePasteRestoreSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pastedBackupText.trim()) return;
    await processIncomingBackupText(pastedBackupText);
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
      const identity = getLinkedCloudIdentity();
      setLinkedIdentity(identity);
      const channel = identity?.vaultChannelId || `vault-${user.uid.slice(0, 12).toLowerCase()}`;
      setSyncIdInput(channel);
      onUpdateSecurityConfig({ ...securityConfig, syncVaultId: channel });
      setSyncFeedback(`Connected as ${user.email}. Ready for permanent Firestore Cloud Sync!`);
    } catch (err: any) {
      if (
        err?.code === 'auth/standalone-apk-direct-bind' ||
        err?.message === 'STANDALONE_APK_DIRECT_BIND'
      ) {
        setShowDirectEmailBind(true);
        setSyncFeedback(null);
        return;
      }
      setShowDirectEmailBind(true);
    }
  };

  const handleDirectEmailBindSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const identity = bindDirectCloudIdentity(directEmailInput);
      setLinkedIdentity(identity);
      setSyncIdInput(identity.vaultChannelId);
      onUpdateSecurityConfig({ ...securityConfig, syncVaultId: identity.vaultChannelId });
      setShowDirectEmailBind(false);
      setDirectEmailInput('');
      setSyncFeedback(
        `Google Identity (${identity.email}) bound directly to Firestore Channel "${identity.vaultChannelId}"!`
      );
    } catch (err: any) {
      setSyncFeedback(err.message || 'Please enter a valid email address.');
    }
  };

  const handleGoogleSignOut = async () => {
    await signOutFromVaultCloud();
    setLinkedIdentity(null);
    setShowDirectEmailBind(false);
    setSyncFeedback('Unlinked Google Cloud identity from this device.');
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

  const activeIdentityEmail = firebaseUser?.email || linkedIdentity?.email || null;

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
          Your encrypted vault (Accounts, Cards, API Keys &amp; Secrets, and Ledger) syncs directly with permanent <strong>Firebase Firestore</strong> storage across your Android phone and PC. Only AES-256-GCM ciphertext is stored in the cloud—your Master Passphrase never leaves your device.
        </p>

        {/* Google Account / Cloud Identity Binding (Works natively in Standalone APK without Chrome unauthorized-domain error!) */}
        <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2.5 text-xs">
              <UserCheck className="w-4 h-4 text-emerald-400 shrink-0" />
              {activeIdentityEmail ? (
                <div>
                  <p className="font-semibold text-slate-200">
                    Linked Google Cloud Identity:{' '}
                    <span className="text-emerald-400 font-mono">{activeIdentityEmail}</span>
                  </p>
                  <p className="text-[10px] text-slate-400 font-mono">
                    Firestore Channel: /vault_sync/{syncIdInput || linkedIdentity?.vaultChannelId}
                  </p>
                </div>
              ) : (
                <div>
                  <p className="font-semibold text-slate-200">Bind Google Account / Cloud Identity</p>
                  <p className="text-[10px] text-slate-400">
                    Link your Google email to automatically generate your personal Firestore Sync Vault ID
                  </p>
                </div>
              )}
            </div>

            {activeIdentityEmail ? (
              <button
                type="button"
                onClick={handleGoogleSignOut}
                className="px-3 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700 text-[11px] font-medium text-slate-300 flex items-center gap-1.5"
              >
                <LogOut className="w-3.5 h-3.5 text-rose-400" />
                <span>Unlink</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={handleGoogleSignIn}
                className="px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold flex items-center gap-1.5 shadow-sm transition-colors"
              >
                <ShieldCheck className="w-4 h-4" />
                <span>Connect Google Account</span>
              </button>
            )}
          </div>

          {showDirectEmailBind && !activeIdentityEmail && (
            <form
              onSubmit={handleDirectEmailBindSubmit}
              className="pt-3 border-t border-slate-800/80 space-y-2.5 animate-fade-in"
            >
              <div className="flex items-start gap-2 text-[11px] text-emerald-300 bg-emerald-500/10 border border-emerald-500/20 p-2.5 rounded-xl">
                <Mail className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                <span>
                  <strong>Standalone Android App Direct Binding:</strong> Enter your Google email below to bind your personal Firestore Cloud Vault directly inside the app (no Chrome browser redirect needed).
                </span>
              </div>
              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  type="email"
                  required
                  value={directEmailInput}
                  onChange={(e) => setDirectEmailInput(e.target.value)}
                  placeholder="Enter your Google email (e.g. yourname@gmail.com)"
                  className="w-full sm:flex-1 h-11 min-h-[44px] px-3.5 rounded-xl bg-slate-900 border border-slate-700 text-xs font-mono text-slate-100 placeholder-slate-500 focus:outline-none focus:border-emerald-500"
                />
                <div className="flex gap-2">
                  <button
                    type="submit"
                    className="flex-1 sm:flex-initial h-11 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold"
                  >
                    Bind Identity
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowDirectEmailBind(false)}
                    className="h-11 px-3 rounded-xl bg-slate-900 border border-slate-700 text-xs text-slate-400"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </form>
          )}
        </div>

        {/* Full-Width Tall Sync Vault ID Input & Action Buttons */}
        <div className="space-y-2.5">
          <label className="block text-xs font-semibold text-slate-300">
            Unique Sync Vault ID (Use this same ID on your Phone &amp; PC to sync):
          </label>
          <input
            type="text"
            value={syncIdInput}
            onChange={(e) => setSyncIdInput(e.target.value)}
            placeholder="e.g. krypton-abebe-2026 or vault-yourname-gmail-com"
            className="w-full h-12 min-h-[48px] px-4 py-3 rounded-xl bg-slate-950 border border-slate-700 text-sm font-mono text-slate-100 placeholder-slate-500 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
          />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
            <button
              type="button"
              onClick={handleCloudPush}
              disabled={isSyncing}
              className="h-12 min-h-[48px] px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold flex items-center justify-center gap-2 transition-colors disabled:opacity-50 shadow-md shadow-emerald-950/50"
            >
              {isSyncing ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <CloudUpload className="w-4 h-4" />
              )}
              <span>Push Encrypted Vault to Firestore</span>
            </button>
            <button
              type="button"
              onClick={() => handleCloudPull()}
              disabled={isSyncing}
              className="h-12 min-h-[48px] px-4 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-200 text-xs font-semibold flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
            >
              <CloudDownload className="w-4 h-4 text-cyan-400" />
              <span>Pull Encrypted Vault from Firestore</span>
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
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                type="password"
                required
                value={syncPassphraseInput}
                onChange={(e) => setSyncPassphraseInput(e.target.value)}
                placeholder="Master Passphrase used when pushing..."
                className="w-full sm:flex-1 h-11 min-h-[44px] px-3.5 rounded-lg bg-slate-900 border border-slate-700 text-xs text-slate-100 focus:outline-none focus:border-emerald-500"
              />
              <button
                type="submit"
                disabled={isSyncing}
                className="px-4 h-11 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold"
              >
                Decrypt &amp; Restore
              </button>
            </div>
          </form>
        )}

        {syncFeedback && (
          <p className="text-xs text-emerald-400 font-medium p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
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
              6-Digit Keypad PIN &amp; Hardware Biometrics
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
                  className="w-full h-11 px-3 rounded-xl bg-slate-900 border border-slate-700 text-xs font-mono tracking-widest text-slate-100 focus:outline-none focus:border-emerald-500"
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
                  className="w-full h-11 px-3 rounded-xl bg-slate-900 border border-slate-700 text-xs text-slate-100 focus:outline-none focus:border-emerald-500"
                />
              </div>
            </div>
            <div className="flex justify-end">
              <button
                type="submit"
                className="px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold"
              >
                Save Quick PIN &amp; Pair Biometrics
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
            Auto-Lock &amp; Screen-Blur Privacy Protection
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
                className={`py-2.5 px-3 rounded-xl text-xs font-semibold font-mono transition-all ${
                  securityConfig.autoLockMinutes === mins
                    ? 'bg-emerald-600 text-white border border-emerald-500 shadow-md shadow-emerald-950/40'
                    : 'bg-slate-900 border border-slate-800 text-slate-400 hover:text-white'
                }`}
              >
                {mins === 0 ? 'Never' : `${mins} min`}
              </button>
            ))}
          </div>
        </div>

        {/* Screen Blur on App Switch — Explicit High-Contrast Toggle Button (Works in Light & Dark Mode) */}
        <div className="flex items-center justify-between pt-3 border-t border-slate-800/80 gap-3">
          <div className="pr-2">
            <p className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
              <EyeOff className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
              <span>Screen-Blur Privacy Shield (Anti-Screenshot / App Switcher)</span>
            </p>
            <p className="text-[10px] text-slate-400 mt-0.5">
              Blurs the viewport immediately when switching tabs or minimizing the app on Android/Web
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={securityConfig.hideScreenOnSwitch}
            onClick={() =>
              onUpdateSecurityConfig({
                ...securityConfig,
                hideScreenOnSwitch: !securityConfig.hideScreenOnSwitch,
              })
            }
            className="flex items-center gap-2 shrink-0 min-h-[44px] px-1 focus:outline-none"
          >
            <span
              className={`text-[10px] font-mono font-bold ${
                securityConfig.hideScreenOnSwitch ? 'text-emerald-400' : 'text-slate-400'
              }`}
            >
              {securityConfig.hideScreenOnSwitch ? 'ON' : 'OFF'}
            </span>
            <div
              className={`relative w-12 h-7 rounded-full border transition-colors flex items-center ${
                securityConfig.hideScreenOnSwitch
                  ? 'toggle-switch-on bg-emerald-600 border-emerald-500'
                  : 'toggle-switch-off bg-slate-700 border-slate-600'
              }`}
            >
              <span
                className={`inline-block w-5 h-5 rounded-full bg-white shadow-md transform transition-transform ${
                  securityConfig.hideScreenOnSwitch ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </div>
          </button>
        </div>

        {/* Lock on Tab Switch — Explicit High-Contrast Toggle Button (Works in Light & Dark Mode) */}
        <div className="flex items-center justify-between pt-3 border-t border-slate-800/80 gap-3">
          <div className="pr-2">
            <p className="text-xs font-semibold text-slate-200">Strict Lock On Tab Switch</p>
            <p className="text-[10px] text-slate-400 mt-0.5">
              Require Master Passphrase / PIN immediately if the app window loses focus
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={securityConfig.lockOnTabSwitch}
            onClick={() =>
              onUpdateSecurityConfig({
                ...securityConfig,
                lockOnTabSwitch: !securityConfig.lockOnTabSwitch,
              })
            }
            className="flex items-center gap-2 shrink-0 min-h-[44px] px-1 focus:outline-none"
          >
            <span
              className={`text-[10px] font-mono font-bold ${
                securityConfig.lockOnTabSwitch ? 'text-emerald-400' : 'text-slate-400'
              }`}
            >
              {securityConfig.lockOnTabSwitch ? 'ON' : 'OFF'}
            </span>
            <div
              className={`relative w-12 h-7 rounded-full border transition-colors flex items-center ${
                securityConfig.lockOnTabSwitch
                  ? 'toggle-switch-on bg-emerald-600 border-emerald-500'
                  : 'toggle-switch-off bg-slate-700 border-slate-600'
              }`}
            >
              <span
                className={`inline-block w-5 h-5 rounded-full bg-white shadow-md transform transition-transform ${
                  securityConfig.lockOnTabSwitch ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </div>
          </button>
        </div>
      </div>

      {/* ================= LOCAL FILE BACKUP & SANDBOX DEMO DATA ================= */}
      <div className="p-5 rounded-2xl bg-[#0c1220] border border-slate-800 space-y-4">
        <div className="flex items-center gap-2">
          <FileKey className="w-4 h-4 text-emerald-400" />
          <h4 className="text-xs font-bold text-slate-200 font-mono">
            Offline File Backup &amp; Demo Sandbox
          </h4>
        </div>

        {/* How They Differ Guide */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5 text-[11px]">
          <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 space-y-1">
            <p className="font-bold text-emerald-400 flex items-center gap-1.5">
              <CloudUpload className="w-3.5 h-3.5 shrink-0" />
              <span>1. Cloud Sync (Above)</span>
            </p>
            <p className="text-slate-400">
              Syncs your encrypted vault online via <strong>Firebase Firestore</strong> using your Sync Vault ID so your Phone and PC stay updated over the internet.
            </p>
          </div>
          <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 space-y-1">
            <p className="font-bold text-cyan-400 flex items-center gap-1.5">
              <FileKey className="w-3.5 h-3.5 shrink-0" />
              <span>2. Offline File Backup</span>
            </p>
            <p className="text-slate-400">
              Exports a standalone AES-256-GCM <code>.json</code> file or text bundle you can save to your phone Downloads, Google Drive, Telegram, or USB drive with zero internet dependency.
            </p>
          </div>
          <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 space-y-1">
            <p className="font-bold text-amber-400 flex items-center gap-1.5">
              <Database className="w-3.5 h-3.5 shrink-0" />
              <span>3. Demo Sandbox</span>
            </p>
            <p className="text-slate-400">
              Loads sample Ethiopian bank accounts, wallets, and test API keys to explore features safely—and lets you delete all demo data in one tap.
            </p>
          </div>
        </div>

        {/* Primary Backup & Sandbox Action Buttons */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5 pt-1">
          <button
            type="button"
            onClick={handleTriggerExport}
            className="h-12 min-h-[48px] flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold transition-colors shadow-sm"
          >
            <Download className="w-4 h-4" />
            <span>{t.emergencyExport}</span>
          </button>

          <label className="h-12 min-h-[48px] flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-700/80 text-slate-200 text-xs font-semibold transition-colors cursor-pointer">
            <Upload className="w-4 h-4 text-cyan-400" />
            <span>Restore from .JSON File</span>
            <input
              type="file"
              accept=".json,application/json,text/plain"
              onChange={handleFileChange}
              className="hidden"
            />
          </label>

          <button
            type="button"
            onClick={() => {
              setShowPasteRestoreModal(!showPasteRestoreModal);
              setExportedBackupData(null);
            }}
            className="h-12 min-h-[48px] flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-700/80 text-slate-200 text-xs font-semibold transition-colors"
          >
            <ClipboardPaste className="w-4 h-4 text-emerald-400" />
            <span>Paste Backup Text</span>
          </button>

          {hasDemoData && onClearDemoData ? (
            <button
              type="button"
              onClick={onClearDemoData}
              className="h-12 min-h-[48px] flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/40 text-rose-300 text-xs font-semibold transition-colors"
            >
              <Trash2 className="w-4 h-4 text-rose-400" />
              <span>Delete All Demo Data</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={onLoadDemoAccounts}
              className="h-12 min-h-[48px] flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-700/80 text-slate-200 text-xs font-semibold transition-colors"
            >
              <Database className="w-4 h-4 text-amber-400" />
              <span>Load Demo Accounts</span>
            </button>
          )}
        </div>

        {/* Exported Backup Ready Panel (Works 100% on Android Standalone APK & Web!) */}
        {exportedBackupData && (
          <div className="p-4 rounded-2xl bg-slate-950 border border-emerald-500/40 space-y-3 animate-fade-in">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
                <span className="text-xs font-bold text-slate-100 font-mono">
                  AES-256-GCM Encrypted Backup Ready ({exportedBackupData.filename})
                </span>
              </div>
              <button
                type="button"
                onClick={() => setExportedBackupData(null)}
                className="text-xs text-slate-400 hover:text-slate-200 px-2 py-1"
              >
                Close
              </button>
            </div>
            <p className="text-[11px] text-slate-400">
              On your Android phone, tap <strong>Share / Save to Phone</strong> to save the <code>.json</code> file to your Downloads, Google Drive, or Telegram, or tap <strong>Copy Encrypted Backup Text</strong>.
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={handleNativeShareBackup}
                className="h-11 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold flex items-center gap-2 shadow-sm"
              >
                <Share2 className="w-4 h-4" />
                <span>Share / Save to Phone</span>
              </button>
              <button
                type="button"
                onClick={handleCopyBackupJson}
                className="h-11 px-4 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-200 text-xs font-semibold flex items-center gap-2"
              >
                {copiedBackupJson ? (
                  <Check className="w-4 h-4 text-emerald-400" />
                ) : (
                  <Copy className="w-4 h-4 text-cyan-400" />
                )}
                <span>{copiedBackupJson ? 'Copied Encrypted JSON!' : 'Copy Encrypted Backup Text'}</span>
              </button>
            </div>
            <textarea
              readOnly
              value={exportedBackupData.json}
              rows={4}
              onClick={(e) => (e.target as HTMLTextAreaElement).select()}
              className="w-full p-3 rounded-xl bg-slate-900 border border-slate-800 text-[10px] font-mono text-slate-300 focus:outline-none"
            />
          </div>
        )}

        {/* Paste Encrypted Backup Text Modal/Drawer for Android & Web Restore */}
        {showPasteRestoreModal && (
          <form
            onSubmit={handlePasteRestoreSubmit}
            className="p-4 rounded-2xl bg-slate-950 border border-cyan-500/40 space-y-3 animate-fade-in"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                <ClipboardPaste className="w-4 h-4 text-cyan-400" />
                <span>Restore from Pasted Encrypted Backup JSON</span>
              </span>
              <button
                type="button"
                onClick={() => setShowPasteRestoreModal(false)}
                className="text-xs text-slate-400 hover:text-slate-200"
              >
                Cancel
              </button>
            </div>
            <p className="text-[11px] text-slate-400">
              Paste the entire AES-256-GCM JSON backup text that you previously exported or copied:
            </p>
            <textarea
              required
              rows={4}
              value={pastedBackupText}
              onChange={(e) => setPastedBackupText(e.target.value)}
              placeholder='{"version":2,"cipher":"AES-256-GCM","salt":"...","iv":"...","ciphertext":"..."}'
              className="w-full p-3 rounded-xl bg-slate-900 border border-slate-700 text-xs font-mono text-slate-100 placeholder-slate-500 focus:outline-none focus:border-emerald-500"
            />
            <div className="flex justify-end gap-2">
              <button
                type="submit"
                className="h-11 px-5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold"
              >
                Verify &amp; Restore Backup
              </button>
            </div>
          </form>
        )}

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
              Enter the Master Passphrase that was active when this backup was exported:
            </p>
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                type="password"
                required
                value={backupPassphraseInput}
                onChange={(e) => setBackupPassphraseInput(e.target.value)}
                placeholder="Backup Master Passphrase..."
                className="w-full sm:flex-1 h-11 min-h-[44px] px-3.5 rounded-xl bg-slate-900 border border-slate-700 text-xs text-slate-100 focus:outline-none focus:border-emerald-500"
              />
              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={isRestoring}
                  className="flex-1 sm:flex-initial px-4 h-11 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold"
                >
                  {isRestoring ? 'Decrypting...' : 'Unlock Backup'}
                </button>
                <button
                  type="button"
                  onClick={() => setPendingBackupJson(null)}
                  className="px-3 h-11 rounded-xl border border-slate-700 text-xs text-slate-400"
                >
                  Cancel
                </button>
              </div>
            </div>
          </form>
        )}

        {importStatus && (
          <p className="text-xs text-emerald-400 font-medium p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center gap-2">
            <Info className="w-4 h-4 shrink-0" />
            <span>{importStatus}</span>
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
                'npm run android:sync'
              );
              setCopiedCapCmd(true);
              setTimeout(() => setCopiedCapCmd(false), 2000);
            }}
            className="text-[11px] font-mono text-emerald-400 hover:text-emerald-300 flex items-center gap-1"
          >
            {copiedCapCmd ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
            <span>{copiedCapCmd ? 'Copied CLI' : 'Copy Sync Command'}</span>
          </button>
        </div>
        <p className="text-xs text-slate-400">
          Configured in <code className="text-emerald-300 font-mono">capacitor.config.ts</code> with App ID <code className="text-slate-300 font-mono">com.kryptonvault.zeroknowledge</code>, <code className="text-slate-300 font-mono">FLAG_SECURE</code> screenshot blocking, and Android Hardware Biometric Keystore.
        </p>
      </div>
    </div>
  );
};

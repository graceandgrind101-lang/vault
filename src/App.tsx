import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Shield,
  Lock,
  Plus,
  Search,
  Smartphone,
  CreditCard,
  ChevronRight,
  Globe2,
  FileCheck,
  RefreshCw,
  Database,
  EyeOff,
} from 'lucide-react';
import {
  AccountRecord,
  ExchangeRatesConfig,
  SupportedLanguage,
  TransactionRecord,
  VaultSecurityConfig,
} from './types/account';
import { INITIAL_SEED_ACCOUNTS } from './utils/seedData';
import { safeSearchAccounts, formatCurrency } from './utils/validator';
import { translations } from './utils/i18n';
import {
  generateSalt,
  deriveKeyFromPassphrase,
  computePassphraseVerifier,
  encryptZeroKnowledgePayload,
  decryptZeroKnowledgePayload,
  createEncryptedVaultBackup,
  restoreEncryptedVaultBackup,
  bufferToBase64,
  base64ToBuffer,
  setupQuickPin,
  registerBiometricPasskey,
} from './utils/crypto';

// Subcomponents
import { AccountFormModal } from './components/AccountFormModal';
import { AccountDetailSheet } from './components/AccountDetailSheet';
import { MasterLockModal } from './components/MasterLockModal';
import { SecurityAuditView } from './components/SecurityAuditView';
import { FinanceView } from './components/FinanceView';
import { CardsView } from './components/CardsView';
import { BottomNavigation, NavigationTab } from './components/BottomNavigation';
import { PWAInstallButton } from './components/PWAInstallButton';
import { OfflineIndicator } from './components/OfflineIndicator';

const STORAGE_KEY_ENCRYPTED_VAULT = 'krypton_vault_encrypted_v2';
const STORAGE_KEY_LEGACY_PLAINTEXT = 'krypton_vault_accounts_v1';
const STORAGE_KEY_VERIFIER = 'krypton_vault_verifier_v2';
const STORAGE_KEY_SALT = 'krypton_vault_salt_v2';
const STORAGE_KEY_CONFIG = 'krypton_vault_config_v1';
const STORAGE_KEY_LANG = 'krypton_vault_lang_v1';
const STORAGE_KEY_FX = 'krypton_vault_fx_v1';

const DEFAULT_EXCHANGE_CONFIG: ExchangeRatesConfig = {
  baseCurrency: 'ETB',
  ratesPerUsd: {
    USD: 1,
    ETB: 128.5,
    EUR: 0.92,
    GBP: 0.79,
    CAD: 1.38,
  },
};

export default function App() {
  // Navigation
  const [currentTab, setCurrentTab] = useState<NavigationTab>('vault');
  const [currentLanguage, setCurrentLanguage] = useState<SupportedLanguage>('en');

  // Vault Security State
  const [isLocked, setIsLocked] = useState(true);
  const [hasExistingMaster, setHasExistingMaster] = useState(false);
  const [masterKey, setMasterKey] = useState<CryptoKey | null>(null);
  const [salt, setSalt] = useState<Uint8Array | null>(null);
  const [isPrivacyBlurred, setIsPrivacyBlurred] = useState(false);

  // Security Configuration
  const [securityConfig, setSecurityConfig] = useState<VaultSecurityConfig>({
    autoLockMinutes: 5,
    biometricEnabled: true,
    lockOnTabSwitch: false,
    hideScreenOnSwitch: true,
  });

  // Multi-Currency Exchange Configuration & Tap-to-Cycle Index
  const [exchangeConfig, setExchangeConfig] = useState<ExchangeRatesConfig>(DEFAULT_EXCHANGE_CONFIG);
  const [balanceCycleIndex, setBalanceCycleIndex] = useState<number>(0);

  // Decrypted Accounts in Memory (only populated while unlocked)
  const [accounts, setAccounts] = useState<AccountRecord[]>([]);

  // Search & Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedFilter, setSelectedFilter] = useState<'all' | 'bank' | 'wallet'>('all');

  // Modals & Bottom Sheets
  const [selectedAccount, setSelectedAccount] = useState<AccountRecord | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingAccount, setEditingAccount] = useState<AccountRecord | null>(null);

  // Toast Notification
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Activity timer ref for auto-lock
  const lastActivityRef = useRef<number>(Date.now());

  const t = translations[currentLanguage];

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3200);
  };

  // Convert between any two currencies using ratesPerUsd
  const convertAmount = (amount: number, fromCurrency: string, toCurrency: string): number => {
    if (!amount) return 0;
    const from = (fromCurrency || 'USD').toUpperCase();
    const to = (toCurrency || 'USD').toUpperCase();
    if (from === to) return amount;

    const fromRate = exchangeConfig.ratesPerUsd[from] || 1;
    const toRate = exchangeConfig.ratesPerUsd[to] || 1;
    const amountInUsd = amount / fromRate;
    return amountInUsd * toRate;
  };

  // 1. Initial Load from LocalStorage (Zero Plaintext Boot)
  useEffect(() => {
    try {
      const savedLang = localStorage.getItem(STORAGE_KEY_LANG) as SupportedLanguage | null;
      if (savedLang && translations[savedLang]) {
        setCurrentLanguage(savedLang);
      }

      const savedConfig = localStorage.getItem(STORAGE_KEY_CONFIG);
      if (savedConfig) {
        setSecurityConfig(JSON.parse(savedConfig));
      }

      const savedFx = localStorage.getItem(STORAGE_KEY_FX);
      if (savedFx) {
        setExchangeConfig(JSON.parse(savedFx));
      }

      // Remove any legacy plaintext storage key so plaintext never lingers on disk
      const legacyPlain = localStorage.getItem(STORAGE_KEY_LEGACY_PLAINTEXT);
      if (legacyPlain) {
        localStorage.removeItem(STORAGE_KEY_LEGACY_PLAINTEXT);
      }

      const savedSalt = localStorage.getItem(STORAGE_KEY_SALT);
      const savedVerifier = localStorage.getItem(STORAGE_KEY_VERIFIER);

      if (savedSalt && savedVerifier) {
        setSalt(base64ToBuffer(savedSalt));
        setHasExistingMaster(true);
        setIsLocked(true);
      } else {
        // First-time user: start with empty vault and require creating Master Passphrase
        setHasExistingMaster(false);
        setIsLocked(true);
        setAccounts([]);
      }
    } catch (err) {
      console.error('Failed to initialize vault storage', err);
    }
  }, []);

  // Encrypts the entire accounts array with AES-256-GCM before saving to localStorage
  const persistEncryptedAccounts = async (
    newAccounts: AccountRecord[],
    activeKey: CryptoKey | null = masterKey
  ) => {
    setAccounts(newAccounts);
    if (!activeKey) return;
    try {
      const { ciphertext, iv } = await encryptZeroKnowledgePayload(newAccounts, activeKey);
      localStorage.setItem(
        STORAGE_KEY_ENCRYPTED_VAULT,
        JSON.stringify({
          version: 2,
          iv,
          ciphertext,
          updatedAt: new Date().toISOString(),
        })
      );
      // Guarantee legacy plaintext key is purged
      localStorage.removeItem(STORAGE_KEY_LEGACY_PLAINTEXT);
    } catch (e) {
      console.error('Error encrypting accounts to storage', e);
    }
  };

  // 2. Auto-Lock, Tab Switch & Privacy Blur Shield Listeners
  useEffect(() => {
    const handleUserActivity = () => {
      lastActivityRef.current = Date.now();
    };

    window.addEventListener('mousemove', handleUserActivity);
    window.addEventListener('keydown', handleUserActivity);
    window.addEventListener('touchstart', handleUserActivity);

    const interval = setInterval(() => {
      if (isLocked || !masterKey || securityConfig.autoLockMinutes === 0) return;
      const elapsedMinutes = (Date.now() - lastActivityRef.current) / (1000 * 60);
      if (elapsedMinutes >= securityConfig.autoLockMinutes) {
        lockVault();
        showToast('Vault auto-locked due to inactivity.');
      }
    }, 15000);

    const handleVisibilityChange = () => {
      if (document.hidden) {
        if (securityConfig.hideScreenOnSwitch) {
          setIsPrivacyBlurred(true);
        }
        if (securityConfig.lockOnTabSwitch && !isLocked) {
          lockVault();
        }
      } else {
        setIsPrivacyBlurred(false);
      }
    };

    const handleWindowBlur = () => {
      if (securityConfig.hideScreenOnSwitch && !isLocked) {
        setIsPrivacyBlurred(true);
      }
    };

    const handleWindowFocus = () => {
      setIsPrivacyBlurred(false);
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('blur', handleWindowBlur);
    window.addEventListener('focus', handleWindowFocus);

    return () => {
      window.removeEventListener('mousemove', handleUserActivity);
      window.removeEventListener('keydown', handleUserActivity);
      window.removeEventListener('touchstart', handleUserActivity);
      clearInterval(interval);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('blur', handleWindowBlur);
      window.removeEventListener('focus', handleWindowFocus);
    };
  }, [isLocked, masterKey, securityConfig]);

  const lockVault = () => {
    setMasterKey(null);
    setSelectedAccount(null);
    setIsFormOpen(false);
    setIsLocked(true);
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      navigator.vibrate(50);
    }
  };

  const unlockVault = async (passphrase: string): Promise<boolean> => {
    if (!salt) return false;
    try {
      const computedVerifier = await computePassphraseVerifier(passphrase, salt);
      const storedVerifier = localStorage.getItem(STORAGE_KEY_VERIFIER);

      if (storedVerifier && storedVerifier !== computedVerifier) {
        return false;
      }

      const candidateKey = await deriveKeyFromPassphrase(passphrase, salt);

      // Decrypt full vault payload from localStorage
      const encryptedRaw = localStorage.getItem(STORAGE_KEY_ENCRYPTED_VAULT);
      if (encryptedRaw) {
        const parsed = JSON.parse(encryptedRaw);
        if (parsed.ciphertext && parsed.iv) {
          const decryptedAccounts = await decryptZeroKnowledgePayload<AccountRecord[]>(
            parsed.ciphertext,
            parsed.iv,
            candidateKey
          );
          setAccounts(Array.isArray(decryptedAccounts) ? decryptedAccounts : []);
        }
      } else {
        setAccounts([]);
      }

      setMasterKey(candidateKey);
      setIsLocked(false);
      setIsPrivacyBlurred(false);
      lastActivityRef.current = Date.now();
      showToast('Vault decrypted and unlocked.');
      return true;
    } catch (e) {
      console.error('Unlock decryption failed', e);
      return false;
    }
  };

  const setupMasterPassphrase = async (
    passphrase: string,
    options?: { quickPin?: string; loadDemo?: boolean; enableBiometrics?: boolean }
  ) => {
    const newSalt = generateSalt();
    setSalt(newSalt);
    localStorage.setItem(STORAGE_KEY_SALT, bufferToBase64(newSalt));

    const key = await deriveKeyFromPassphrase(passphrase, newSalt);
    setMasterKey(key);

    const verifier = await computePassphraseVerifier(passphrase, newSalt);
    localStorage.setItem(STORAGE_KEY_VERIFIER, verifier);

    if (options?.quickPin) {
      await setupQuickPin(options.quickPin, passphrase);
    }
    if (options?.enableBiometrics) {
      await registerBiometricPasskey(passphrase);
    }

    const initialAccounts = options?.loadDemo ? INITIAL_SEED_ACCOUNTS : [];
    await persistEncryptedAccounts(initialAccounts, key);

    setHasExistingMaster(true);
    setIsLocked(false);
    showToast(
      options?.loadDemo
        ? 'Encrypted vault initialized with 4 demo accounts.'
        : 'Empty zero-knowledge vault initialized.'
    );
  };

  const handleLoadDemoAccounts = () => {
    if (!masterKey) return;
    const existingIds = new Set(accounts.map((a) => a.id));
    const merged = [
      ...accounts,
      ...INITIAL_SEED_ACCOUNTS.filter((seed) => !existingIds.has(seed.id)),
    ];
    persistEncryptedAccounts(merged, masterKey);
    showToast('Demo accounts loaded into your encrypted vault.');
  };

  // Language switch
  const handleLanguageChange = (lang: SupportedLanguage) => {
    setCurrentLanguage(lang);
    localStorage.setItem(STORAGE_KEY_LANG, lang);
  };

  // Exchange Rate Config Update
  const handleUpdateExchangeConfig = (cfg: ExchangeRatesConfig) => {
    setExchangeConfig(cfg);
    localStorage.setItem(STORAGE_KEY_FX, JSON.stringify(cfg));
  };

  // Add / Edit Account
  const handleSaveAccount = (accountData: Partial<AccountRecord>) => {
    if (editingAccount) {
      const updated = accounts.map((a) =>
        a.id === editingAccount.id
          ? ({
              ...a,
              ...accountData,
              updatedAt: new Date().toISOString(),
            } as AccountRecord)
          : a
      );
      persistEncryptedAccounts(updated);
      showToast('Account updated in AES-256-GCM vault.');
      if (selectedAccount?.id === editingAccount.id) {
        setSelectedAccount(updated.find((x) => x.id === editingAccount.id) || null);
      }
      setEditingAccount(null);
    } else {
      const newAcc: AccountRecord = {
        id: `acc-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        name: accountData.name!,
        accountNumber: accountData.accountNumber!,
        phoneNumber: accountData.phoneNumber!,
        atm: accountData.atm || { hasAtm: false },
        mobileBanking: accountData.mobileBanking || { hasMobileBanking: false },
        totp: accountData.totp,
        orgName: accountData.orgName,
        branchName: accountData.branchName,
        currency: accountData.currency || exchangeConfig.baseCurrency || 'ETB',
        language: accountData.language || currentLanguage,
        memo: accountData.memo,
        currentBalance: accountData.currentBalance || 0,
        transactions: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      persistEncryptedAccounts([newAcc, ...accounts]);
      showToast('New account encrypted and saved.');
    }
  };

  // Delete Account
  const handleDeleteAccount = (id: string) => {
    const filtered = accounts.filter((a) => a.id !== id);
    persistEncryptedAccounts(filtered);
    if (selectedAccount?.id === id) setSelectedAccount(null);
    showToast('Account permanently purged from vault.');
  };

  // Add Transaction to Account
  const handleAddTransaction = (
    accountId: string,
    txData: Omit<TransactionRecord, 'id' | 'accountId'>
  ) => {
    const newTx: TransactionRecord = {
      ...txData,
      id: `tx-${Date.now()}`,
      accountId,
    };
    const updated = accounts.map((acc) => {
      if (acc.id === accountId) {
        const delta = txData.type === 'income' ? txData.amount : -txData.amount;
        return {
          ...acc,
          currentBalance: acc.currentBalance + delta,
          transactions: [newTx, ...(acc.transactions || [])],
          updatedAt: new Date().toISOString(),
        };
      }
      return acc;
    });
    persistEncryptedAccounts(updated);
    if (selectedAccount?.id === accountId) {
      setSelectedAccount(updated.find((x) => x.id === accountId) || null);
    }
    showToast('Transaction encrypted to ledger.');
  };

  // Delete Transaction
  const handleDeleteTransaction = (accountId: string, txId: string) => {
    const updated = accounts.map((acc) => {
      if (acc.id === accountId) {
        const targetTx = acc.transactions.find((t) => t.id === txId);
        const delta = targetTx
          ? targetTx.type === 'income'
            ? -targetTx.amount
            : targetTx.amount
          : 0;
        return {
          ...acc,
          currentBalance: acc.currentBalance + delta,
          transactions: acc.transactions.filter((t) => t.id !== txId),
          updatedAt: new Date().toISOString(),
        };
      }
      return acc;
    });
    persistEncryptedAccounts(updated);
    if (selectedAccount?.id === accountId) {
      setSelectedAccount(updated.find((x) => x.id === accountId) || null);
    }
  };

  // Export Encrypted Backup
  const handleExportBackup = async () => {
    if (!masterKey || !salt) {
      showToast('Unlock vault first to export.');
      return;
    }
    try {
      const jsonBackup = await createEncryptedVaultBackup(accounts, masterKey, salt);
      const blob = new Blob([jsonBackup], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `krypton_vault_backup_${new Date().toISOString().split('T')[0]}.json`;
      a.click();
      URL.revokeObjectURL(url);
      showToast('Encrypted backup exported safely.');
    } catch {
      showToast('Backup export failed.');
    }
  };

  // Import Encrypted Backup (supports current key OR user-entered backup passphrase)
  const handleImportBackup = async (
    jsonString: string,
    passphrase?: string
  ): Promise<boolean> => {
    try {
      const parsed = JSON.parse(jsonString);
      if (!parsed.salt || !parsed.iv || !parsed.ciphertext) {
        showToast('Invalid backup file format.');
        return false;
      }

      if (passphrase) {
        const { data } = await restoreEncryptedVaultBackup(jsonString, passphrase);
        if (Array.isArray(data)) {
          await persistEncryptedAccounts(data);
          showToast(`Restored ${data.length} accounts from encrypted backup!`);
          return true;
        }
        return false;
      }

      // Try decrypting with current active masterKey if salt matches
      if (masterKey && salt && parsed.salt === bufferToBase64(salt)) {
        const data = await decryptZeroKnowledgePayload<AccountRecord[]>(
          parsed.ciphertext,
          parsed.iv,
          masterKey
        );
        if (Array.isArray(data)) {
          await persistEncryptedAccounts(data);
          showToast(`Restored ${data.length} accounts from backup!`);
          return true;
        }
      }
      return false;
    } catch {
      return false;
    }
  };

  // Push Zero-Knowledge Encrypted Cloud Sync
  const handlePushCloudSync = async (syncId: string): Promise<boolean> => {
    if (!masterKey || !salt) return false;
    try {
      const { ciphertext, iv } = await encryptZeroKnowledgePayload(accounts, masterKey);
      const res = await fetch('/api/sync/push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          syncId,
          salt: bufferToBase64(salt),
          iv,
          ciphertext,
        }),
      });
      if (!res.ok) return false;
      const data = await res.json();
      const updatedCfg: VaultSecurityConfig = {
        ...securityConfig,
        syncVaultId: syncId,
        lastSyncedAt: data.updatedAt,
      };
      setSecurityConfig(updatedCfg);
      localStorage.setItem(STORAGE_KEY_CONFIG, JSON.stringify(updatedCfg));
      showToast('Encrypted vault synced to cloud.');
      return true;
    } catch {
      return false;
    }
  };

  // Pull Zero-Knowledge Encrypted Cloud Sync
  const handlePullCloudSync = async (
    syncId: string,
    passphrase?: string
  ): Promise<boolean> => {
    try {
      const res = await fetch(`/api/sync/pull/${encodeURIComponent(syncId)}`);
      if (!res.ok) return false;
      const record = await res.json();
      if (!record.salt || !record.iv || !record.ciphertext) return false;

      if (passphrase) {
        const remoteSalt = base64ToBuffer(record.salt);
        const remoteKey = await deriveKeyFromPassphrase(passphrase, remoteSalt);
        const decrypted = await decryptZeroKnowledgePayload<AccountRecord[]>(
          record.ciphertext,
          record.iv,
          remoteKey
        );
        if (Array.isArray(decrypted)) {
          await persistEncryptedAccounts(decrypted);
          showToast(`Pulled & decrypted ${decrypted.length} accounts from Cloud Sync!`);
          return true;
        }
        return false;
      }

      if (masterKey && salt && record.salt === bufferToBase64(salt)) {
        const decrypted = await decryptZeroKnowledgePayload<AccountRecord[]>(
          record.ciphertext,
          record.iv,
          masterKey
        );
        if (Array.isArray(decrypted)) {
          await persistEncryptedAccounts(decrypted);
          showToast(`Pulled ${decrypted.length} accounts from Cloud Sync!`);
          return true;
        }
      }
      return false;
    } catch {
      return false;
    }
  };

  // Safe Search Filtered Accounts (SECURITY LAW 2: PIN fields are strictly ignored)
  const filteredAccounts = useMemo(() => {
    let result = safeSearchAccounts(accounts, searchQuery);
    if (selectedFilter === 'bank') {
      result = result.filter(
        (a) => a.atm?.hasAtm || (a.orgName && !a.orgName.toLowerCase().includes('wallet'))
      );
    } else if (selectedFilter === 'wallet') {
      result = result.filter(
        (a) => !a.atm?.hasAtm || (a.orgName && a.orgName.toLowerCase().includes('wallet'))
      );
    }
    return result;
  }, [accounts, searchQuery, selectedFilter]);

  // Multi-Currency Breakdown & Tap-to-Cycle Modes
  const balanceDisplayModes = useMemo(() => {
    const convertedBaseTotal = accounts.reduce(
      (sum, acc) =>
        sum + convertAmount(acc.currentBalance, acc.currency, exchangeConfig.baseCurrency),
      0
    );

    const byCurrency: Record<string, number> = {};
    accounts.forEach((acc) => {
      byCurrency[acc.currency] = (byCurrency[acc.currency] || 0) + acc.currentBalance;
    });

    const modes: { label: string; formatted: string; sublabel: string }[] = [
      {
        label: `${t.totalBalance} (${exchangeConfig.baseCurrency})`,
        formatted: formatCurrency(convertedBaseTotal, exchangeConfig.baseCurrency),
        sublabel: 'Converted Base · Tap to cycle currencies',
      },
    ];

    Object.entries(byCurrency).forEach(([curr, rawSum]) => {
      modes.push({
        label: `${curr} Holdings Only`,
        formatted: formatCurrency(rawSum, curr),
        sublabel: `Native ${curr} Total · Tap to cycle`,
      });
    });

    return modes;
  }, [accounts, exchangeConfig, t.totalBalance]);

  const activeBalanceDisplay =
    balanceDisplayModes[balanceCycleIndex % balanceDisplayModes.length] || balanceDisplayModes[0];

  const totalCards = useMemo(() => {
    return accounts.filter((a) => a.atm?.hasAtm).length;
  }, [accounts]);

  return (
    <div className="min-h-screen bg-[#070b14] text-slate-100 flex flex-col font-sans selection:bg-emerald-500/30 selection:text-emerald-200">
      <OfflineIndicator />

      {/* ================= SCREEN-BLUR PRIVACY SHIELD OVERLAY ================= */}
      {isPrivacyBlurred && !isLocked && (
        <div
          onClick={() => setIsPrivacyBlurred(false)}
          className="fixed inset-0 z-50 bg-[#070b14]/90 backdrop-blur-2xl flex flex-col items-center justify-center p-6 text-center cursor-pointer animate-fade-in"
        >
          <div className="w-16 h-16 rounded-2xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center mb-4">
            <EyeOff className="w-8 h-8 text-emerald-400" />
          </div>
          <h3 className="text-lg font-extrabold text-slate-100">
            Krypton Privacy Shield Active
          </h3>
          <p className="text-xs text-slate-400 max-w-xs mt-1">
            Screen contents are blurred while switching apps to prevent shoulder-surfing and app-switcher screenshots. Tap anywhere to resume.
          </p>
        </div>
      )}

      {/* ================= 1. TOP BAR ================= */}
      <header className="sticky top-0 z-30 bg-[#070b14]/90 backdrop-blur-xl border-b border-slate-800/80 px-4 sm:px-6 py-3.5">
        <div className="max-w-6xl mx-auto flex items-center justify-between gap-4">
          {/* Zone 1: Brand Wordmark */}
          <div className="flex items-center gap-2.5 shrink-0">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-700 flex items-center justify-center shadow-lg shadow-emerald-950/50">
              <Shield className="w-5 h-5 text-slate-950 stroke-[2.2]" />
            </div>
            <div>
              <span className="text-base sm:text-lg font-extrabold tracking-tight text-slate-100 whitespace-nowrap">
                {t.appName}
              </span>
              <span className="hidden sm:inline-block ml-2.5 text-xs font-mono text-slate-400">
                · Zero-Knowledge AES-256
              </span>
            </div>
          </div>

          {/* Zone 2: Navigation Links for Desktop */}
          <nav className="hidden md:flex items-center gap-6 text-xs font-semibold text-slate-400">
            <button
              onClick={() => setCurrentTab('vault')}
              className={`hover:text-white transition-colors whitespace-nowrap ${
                currentTab === 'vault' ? 'text-emerald-400' : ''
              }`}
            >
              {t.tabs.vault}
            </button>
            <button
              onClick={() => setCurrentTab('cards')}
              className={`hover:text-white transition-colors whitespace-nowrap ${
                currentTab === 'cards' ? 'text-emerald-400' : ''
              }`}
            >
              {t.tabs.cards}
            </button>
            <button
              onClick={() => setCurrentTab('finance')}
              className={`hover:text-white transition-colors whitespace-nowrap ${
                currentTab === 'finance' ? 'text-emerald-400' : ''
              }`}
            >
              {t.tabs.finance}
            </button>
            <button
              onClick={() => setCurrentTab('security')}
              className={`hover:text-white transition-colors whitespace-nowrap ${
                currentTab === 'security' ? 'text-emerald-400' : ''
              }`}
            >
              {t.tabs.security}
            </button>
          </nav>

          {/* Zone 3: Primary Action & Utility Controls */}
          <div className="flex items-center gap-2 shrink-0">
            {/* Base Currency Quick Toggle */}
            <select
              aria-label="Select base currency"
              value={exchangeConfig.baseCurrency}
              onChange={(e) => {
                handleUpdateExchangeConfig({
                  ...exchangeConfig,
                  baseCurrency: e.target.value,
                });
                setBalanceCycleIndex(0);
              }}
              className="px-2.5 py-1.5 rounded-xl bg-slate-900 border border-slate-800 text-[11px] font-mono font-semibold text-emerald-400 focus:outline-none focus:border-emerald-500"
              title="Primary Base Currency"
            >
              <option value="ETB">ETB</option>
              <option value="USD">USD</option>
              <option value="EUR">EUR</option>
              <option value="GBP">GBP</option>
            </select>

            {/* Language Selector */}
            <div className="relative flex items-center">
              <Globe2 className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 pointer-events-none" />
              <select
                aria-label="Select interface language"
                value={currentLanguage}
                onChange={(e) => handleLanguageChange(e.target.value as SupportedLanguage)}
                className="pl-7 pr-3 py-1.5 rounded-xl bg-slate-900 border border-slate-800 text-[11px] font-medium text-slate-200 focus:outline-none focus:border-emerald-500"
              >
                <option value="en">EN</option>
                <option value="am">አማርኛ</option>
                <option value="om">Oromoo</option>
                <option value="fr">FR</option>
                <option value="es">ES</option>
              </select>
            </div>

            {/* PWA Install Button */}
            <PWAInstallButton />

            {/* Lock Vault Button */}
            <button
              type="button"
              onClick={lockVault}
              aria-label="Lock Vault Now"
              className="p-2 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 transition-colors"
              title="Lock Vault"
            >
              <Lock className="w-4 h-4 text-emerald-400" />
            </button>
          </div>
        </div>
      </header>

      {/* ================= 2. MAIN CONTENT ================= */}
      <main className="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-6 py-5">
        {/* TAB 1: VAULT (ACCOUNTS FEED & SEARCH) */}
        {currentTab === 'vault' && (
          <div className="space-y-6 pb-20">
            {/* Top Metrics Cards Row */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              {/* Stat 1: Total Assets (Interactive Tap-to-Cycle Multi-Currency Card) */}
              <button
                type="button"
                onClick={() => setBalanceCycleIndex((prev) => prev + 1)}
                className="p-4 rounded-2xl bg-gradient-to-br from-slate-900 via-slate-900/90 to-slate-950 border border-slate-800/80 hover:border-emerald-500/40 text-left transition-all group"
              >
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-mono text-slate-400">
                    {activeBalanceDisplay.label}
                  </span>
                  <RefreshCw className="w-3 h-3 text-slate-500 group-hover:text-emerald-400 transition-colors" />
                </div>
                <p className="text-xl sm:text-2xl font-mono font-extrabold text-slate-100 mt-1 tabular-nums truncate">
                  {activeBalanceDisplay.formatted}
                </p>
                <span className="text-[10px] text-emerald-400 font-mono mt-1 block truncate">
                  {activeBalanceDisplay.sublabel}
                </span>
              </button>

              {/* Stat 2: Active Accounts */}
              <div className="p-4 rounded-2xl bg-gradient-to-br from-slate-900 via-slate-900/90 to-slate-950 border border-slate-800/80">
                <span className="text-[10px] font-mono text-slate-400">{t.activeAccounts}</span>
                <p className="text-xl sm:text-2xl font-mono font-extrabold text-slate-100 mt-1 tabular-nums">
                  {accounts.length}
                </p>
                <span className="text-[10px] text-slate-400 font-mono mt-1 block">
                  Banks &amp; Mobile Wallets
                </span>
              </div>

              {/* Stat 3: Virtual Cards */}
              <div className="p-4 rounded-2xl bg-gradient-to-br from-slate-900 via-slate-900/90 to-slate-950 border border-slate-800/80">
                <span className="text-[10px] font-mono text-slate-400">{t.virtualCards}</span>
                <p className="text-xl sm:text-2xl font-mono font-extrabold text-emerald-400 mt-1 tabular-nums">
                  {totalCards}
                </p>
                <span className="text-[10px] text-slate-400 font-mono mt-1 block">
                  3D Interactive Cards
                </span>
              </div>

              {/* Stat 4: Zero-Knowledge Shield */}
              <div className="p-4 rounded-2xl bg-gradient-to-br from-slate-900 via-slate-900/90 to-slate-950 border border-emerald-500/20">
                <span className="text-[10px] font-mono text-emerald-400">Storage Encryption</span>
                <p className="text-lg font-bold text-slate-100 mt-1 flex items-center gap-1.5">
                  <Shield className="w-4 h-4 text-emerald-400" />
                  AES-256-GCM
                </p>
                <span className="text-[10px] text-slate-400 font-mono mt-1 block">
                  Full Vault Encrypted at Rest
                </span>
              </div>
            </div>

            {/* Safe Search & Primary Action Row */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
              {/* Search Bar (strictly adheres to SECURITY LAW 2) */}
              <div className="relative flex-1">
                <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-3.5 pointer-events-none" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={t.searchPlaceholder}
                  className="w-full h-11 pl-10 pr-4 rounded-2xl bg-slate-900/90 border border-slate-800 text-slate-100 placeholder-slate-500 text-xs sm:text-sm focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
                />
              </div>

              {/* Filter Tabs */}
              <div className="flex items-center gap-1 p-1 bg-slate-900 border border-slate-800 rounded-2xl self-start sm:self-auto shrink-0">
                <button
                  type="button"
                  onClick={() => setSelectedFilter('all')}
                  className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-colors ${
                    selectedFilter === 'all'
                      ? 'bg-emerald-600 text-white'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  All ({accounts.length})
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedFilter('bank')}
                  className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-colors ${
                    selectedFilter === 'bank'
                      ? 'bg-emerald-600 text-white'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  Banks ({accounts.filter((a) => a.atm?.hasAtm).length})
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedFilter('wallet')}
                  className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-colors ${
                    selectedFilter === 'wallet'
                      ? 'bg-emerald-600 text-white'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  Wallets ({accounts.filter((a) => !a.atm?.hasAtm).length})
                </button>
              </div>

              {/* Add New Account Button */}
              <button
                type="button"
                onClick={() => {
                  setEditingAccount(null);
                  setIsFormOpen(true);
                }}
                className="h-11 px-4 rounded-2xl bg-emerald-600 hover:bg-emerald-500 active:scale-95 text-white text-xs font-semibold flex items-center justify-center gap-2 shadow-lg shadow-emerald-950 transition-all shrink-0"
              >
                <Plus className="w-4 h-4" />
                <span>{t.newAccount}</span>
              </button>
            </div>

            {/* Account List Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredAccounts.length > 0 ? (
                filteredAccounts.map((account) => (
                  <div
                    key={account.id}
                    onClick={() => setSelectedAccount(account)}
                    className="p-4 rounded-3xl bg-[#0c1220] hover:bg-[#0f172a] border border-slate-800/90 hover:border-emerald-500/30 transition-all cursor-pointer shadow-lg group flex flex-col justify-between active:scale-[0.99]"
                  >
                    <div>
                      {/* Top Header */}
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2.5">
                          <div className="w-9 h-9 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-center text-emerald-400 group-hover:scale-105 transition-transform">
                            {account.atm?.hasAtm ? (
                              <CreditCard className="w-4 h-4" />
                            ) : (
                              <Smartphone className="w-4 h-4" />
                            )}
                          </div>
                          <div>
                            <p className="text-xs font-bold text-slate-100 group-hover:text-emerald-400 transition-colors">
                              {account.name}
                            </p>
                            <p className="text-[10px] text-slate-400 font-mono">
                              {account.orgName || 'Bank Vault'}
                            </p>
                          </div>
                        </div>
                        <span className="text-xs font-mono text-slate-400">
                          {account.currency}
                        </span>
                      </div>

                      {/* Account Number */}
                      <div className="space-y-1 mb-3">
                        <p className="text-[10px] font-mono text-slate-400">Account Number</p>
                        <p className="text-sm font-mono font-semibold text-slate-200 tracking-wider">
                          {account.accountNumber}
                        </p>
                      </div>

                      {/* Clean unboxed metadata line */}
                      <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-400 font-mono">
                        {account.atm?.hasAtm && (
                          <span className="text-emerald-400">ATM Card</span>
                        )}
                        {account.atm?.hasAtm && account.mobileBanking?.hasMobileBanking && (
                          <span aria-hidden="true">·</span>
                        )}
                        {account.mobileBanking?.hasMobileBanking && (
                          <span className="text-cyan-400">Mobile PIN</span>
                        )}
                        {account.totp?.hasTotp && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="text-amber-400">2FA Token</span>
                          </>
                        )}
                      </div>
                    </div>

                    {/* Bottom Row: Balance & Chevron */}
                    <div className="pt-3 mt-3 border-t border-slate-800/80 flex items-center justify-between">
                      <div>
                        <span className="text-[10px] font-mono text-slate-400">Balance</span>
                        <p className="text-base font-bold font-mono text-slate-100 tabular-nums">
                          {formatCurrency(account.currentBalance, account.currency)}
                        </p>
                      </div>
                      <div className="p-1.5 rounded-xl bg-slate-900 group-hover:bg-emerald-600/20 text-slate-400 group-hover:text-emerald-400 transition-colors">
                        <ChevronRight className="w-4 h-4" />
                      </div>
                    </div>
                  </div>
                ))
              ) : (
                <div className="col-span-full py-14 text-center space-y-4 p-8 rounded-3xl bg-slate-900/30 border border-slate-800">
                  <div className="w-12 h-12 rounded-2xl bg-slate-800 flex items-center justify-center mx-auto text-emerald-400">
                    <Shield className="w-6 h-6" />
                  </div>
                  <div className="space-y-1">
                    <h4 className="text-sm font-bold text-slate-200">
                      {accounts.length === 0
                        ? 'Your Encrypted Vault is Empty'
                        : 'No matching accounts found'}
                    </h4>
                    <p className="text-xs text-slate-400 max-w-md mx-auto">
                      {accounts.length === 0
                        ? 'Add your first bank account or mobile wallet, or load sample demo accounts to explore 3D virtual cards, USSD dialers, and 2FA tokens.'
                        : 'Check your search query. PIN numbers are never indexed in search per zero-knowledge law.'}
                    </p>
                  </div>
                  {accounts.length === 0 && (
                    <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
                      <button
                        type="button"
                        onClick={() => {
                          setEditingAccount(null);
                          setIsFormOpen(true);
                        }}
                        className="px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold flex items-center gap-1.5"
                      >
                        <Plus className="w-4 h-4" />
                        <span>Add First Account</span>
                      </button>
                      <button
                        type="button"
                        onClick={handleLoadDemoAccounts}
                        className="px-4 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-200 text-xs font-semibold flex items-center gap-1.5"
                      >
                        <Database className="w-4 h-4 text-cyan-400" />
                        <span>Load Demo Accounts (Sandbox)</span>
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB 2: VIRTUAL CARDS */}
        {currentTab === 'cards' && (
          <CardsView
            accounts={accounts}
            onSelectAccount={(acc) => setSelectedAccount(acc)}
            onAddNewAccount={() => {
              setEditingAccount(null);
              setIsFormOpen(true);
            }}
            isUnlocked={!isLocked}
            currentLanguage={currentLanguage}
          />
        )}

        {/* TAB 3: FINANCE & LEDGER */}
        {currentTab === 'finance' && (
          <FinanceView
            accounts={accounts}
            onSelectAccount={(acc) => setSelectedAccount(acc)}
            currentLanguage={currentLanguage}
            exchangeConfig={exchangeConfig}
            onUpdateExchangeConfig={handleUpdateExchangeConfig}
            convertAmount={convertAmount}
          />
        )}

        {/* TAB 4: SECURITY & AUDIT */}
        {currentTab === 'security' && (
          <SecurityAuditView
            accounts={accounts}
            securityConfig={securityConfig}
            onUpdateSecurityConfig={(cfg) => {
              setSecurityConfig(cfg);
              localStorage.setItem(STORAGE_KEY_CONFIG, JSON.stringify(cfg));
              showToast('Security policy updated.');
            }}
            onExportBackup={handleExportBackup}
            onImportBackup={handleImportBackup}
            onPushCloudSync={handlePushCloudSync}
            onPullCloudSync={handlePullCloudSync}
            onLoadDemoAccounts={handleLoadDemoAccounts}
            currentLanguage={currentLanguage}
          />
        )}
      </main>

      {/* ================= 3. BOTTOM NAVIGATION ================= */}
      <BottomNavigation
        currentTab={currentTab}
        onChangeTab={(tab) => setCurrentTab(tab)}
        currentLanguage={currentLanguage}
      />

      {/* ================= 4. ACCOUNT DETAIL BOTTOM SHEET ================= */}
      <AccountDetailSheet
        account={selectedAccount}
        isOpen={!!selectedAccount}
        onClose={() => setSelectedAccount(null)}
        onEdit={(acc) => {
          setEditingAccount(acc);
          setIsFormOpen(true);
        }}
        onDelete={handleDeleteAccount}
        onAddTransaction={handleAddTransaction}
        onDeleteTransaction={handleDeleteTransaction}
        isVaultUnlocked={!isLocked}
        currentLanguage={currentLanguage}
      />

      {/* ================= 5. ACCOUNT ADD/EDIT MODAL ================= */}
      <AccountFormModal
        isOpen={isFormOpen}
        onClose={() => {
          setIsFormOpen(false);
          setEditingAccount(null);
        }}
        onSave={handleSaveAccount}
        initialAccount={editingAccount}
        currentLanguage={currentLanguage}
      />

      {/* ================= 6. MASTER LOCK OVERLAY ================= */}
      <MasterLockModal
        isLocked={isLocked}
        onUnlock={unlockVault}
        onSetupMaster={setupMasterPassphrase}
        hasExistingMaster={hasExistingMaster}
        currentLanguage={currentLanguage}
      />

      {/* ================= 7. TOAST FEEDBACK NOTIFICATION ================= */}
      {toastMessage && (
        <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-50 rounded-xl bg-slate-900/90 border border-emerald-500/40 backdrop-blur-md px-4 py-2 text-xs font-semibold text-emerald-300 shadow-2xl animate-fade-in flex items-center gap-2">
          <FileCheck className="w-4 h-4 text-emerald-400" />
          <span>{toastMessage}</span>
        </div>
      )}
    </div>
  );
}

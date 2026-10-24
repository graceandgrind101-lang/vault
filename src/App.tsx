import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
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
  KeyRound,
  Wallet,
  PieChart,
  Sun,
  Moon,
  AlertTriangle,
  Menu,
  X,
} from 'lucide-react';
import {
  AccountRecord,
  ExchangeRatesConfig,
  SupportedLanguage,
  TransactionRecord,
  VaultSecurityConfig,
} from './types/account';
import {
  SecretAuditAction,
  SecretAuditLogEntry,
  SecretItem,
} from './types/secret';
import { INITIAL_SEED_ACCOUNTS } from './utils/seedData';
import {
  DEMO_SECRET_IDS,
  createDemoSecretItems,
  evaluateSecretUrgency,
  toMetadataProjection,
} from './utils/secretHelpers';
import { Trash2 } from 'lucide-react';
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
  PBKDF2_ITERATIONS_V2,
  PBKDF2_ITERATIONS_LEGACY,
} from './utils/crypto';

// Subcomponents
import { AccountFormModal } from './components/AccountFormModal';
import { AccountDetailSheet } from './components/AccountDetailSheet';
import { MasterLockModal } from './components/MasterLockModal';
import { SecurityAuditView } from './components/SecurityAuditView';
import { FinanceView } from './components/FinanceView';
import { CardsView } from './components/CardsView';
import { SecretsVaultView } from './components/SecretsVaultView';
import { BottomNavigation, NavigationTab } from './components/BottomNavigation';
import { PWAInstallButton } from './components/PWAInstallButton';
import { OfflineIndicator } from './components/OfflineIndicator';
import {
  auth,
  pushFirestoreSyncChannel,
  pullFirestoreSyncChannel,
  pushAuthenticatedUserVault,
  pullAuthenticatedUserVault,
  syncTrackerMetadataDirect,
  resolveApiUrl,
} from './firebase';

const STORAGE_KEY_ENCRYPTED_VAULT = 'krypton_vault_encrypted_v2';
const STORAGE_KEY_ENCRYPTED_SECRETS = 'krypton_vault_secrets_encrypted_v1';
const STORAGE_KEY_ENCRYPTED_AUDIT = 'krypton_vault_audit_encrypted_v1';
const STORAGE_KEY_LEGACY_PLAINTEXT = 'krypton_vault_accounts_v1';
const STORAGE_KEY_VERIFIER = 'krypton_vault_verifier_v2';
const STORAGE_KEY_SALT = 'krypton_vault_salt_v2';
const STORAGE_KEY_CONFIG = 'krypton_vault_config_v1';
const STORAGE_KEY_LANG = 'krypton_vault_lang_v1';
const STORAGE_KEY_FX = 'krypton_vault_fx_v1';
const STORAGE_KEY_THEME = 'krypton_vault_theme_v1';

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
  // Navigation & Deep-Link State
  const [currentTab, setCurrentTab] = useState<NavigationTab>('vault');
  const [currentLanguage, setCurrentLanguage] = useState<SupportedLanguage>('en');
  const [themeMode, setThemeMode] = useState<'dark' | 'light'>('dark');
  const [highlightedSecretId, setHighlightedSecretId] = useState<string | null>(null);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  // Vault Security State
  const [isLocked, setIsLocked] = useState(true);
  const [hasExistingMaster, setHasExistingMaster] = useState(false);
  const [masterKey, setMasterKey] = useState<CryptoKey | null>(null);
  const [salt, setSalt] = useState<Uint8Array | null>(null);
  const [isPrivacyBlurred, setIsPrivacyBlurred] = useState(false);
  const [lastVerifiedAt, setLastVerifiedAt] = useState<number>(0);

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

  // Decrypted Vault Records in Memory (only populated while unlocked)
  const [accounts, setAccounts] = useState<AccountRecord[]>([]);
  const [secrets, setSecrets] = useState<SecretItem[]>([]);
  const [auditLogs, setAuditLogs] = useState<SecretAuditLogEntry[]>([]);

  // Search & Filters for Bank Accounts
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

  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3200);
  }, []);

  // Parse deep link `/vault/api-keys/<id>` or `?secretId=<id>`
  useEffect(() => {
    const parseDeepLink = () => {
      const path = window.location.pathname;
      const match = path.match(/^\/vault\/api-keys\/([^/]+)$/);
      const params = new URLSearchParams(window.location.search);
      const querySecretId = params.get('secretId');

      const targetId = match ? decodeURIComponent(match[1]) : querySecretId;
      if (targetId) {
        setCurrentTab('secrets');
        setHighlightedSecretId(targetId);
      } else if (path === '/vault/api-keys') {
        setCurrentTab('secrets');
      }
    };

    parseDeepLink();
    window.addEventListener('popstate', parseDeepLink);
    return () => window.removeEventListener('popstate', parseDeepLink);
  }, []);

  // Sync metadata-only projections directly to Firebase Firestore (+ server cache) so SaaS Tracker works from standalone APK & Web
  const syncSecretMetadataToServer = useCallback(async (items: SecretItem[]) => {
    try {
      const projections = items.map(toMetadataProjection);
      await syncTrackerMetadataDirect(projections);
      fetch(resolveApiUrl('/api/tracker/sync-metadata'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: projections }),
      }).catch(() => {});
    } catch {
      // Non-fatal if offline
    }
  }, []);

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

      const savedTheme = localStorage.getItem(STORAGE_KEY_THEME) as 'dark' | 'light' | null;
      if (savedTheme === 'light' || savedTheme === 'dark') {
        setThemeMode(savedTheme);
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
        setHasExistingMaster(false);
        setIsLocked(true);
        setAccounts([]);
        setSecrets([]);
        setAuditLogs([]);
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
      localStorage.removeItem(STORAGE_KEY_LEGACY_PLAINTEXT);
    } catch (e) {
      console.error('Error encrypting accounts to storage', e);
    }
  };

  // Encrypts the secrets array with AES-256-GCM before saving to localStorage & syncs metadata projection
  const persistEncryptedSecrets = async (
    newSecrets: SecretItem[],
    activeKey: CryptoKey | null = masterKey
  ) => {
    setSecrets(newSecrets);
    syncSecretMetadataToServer(newSecrets);
    if (!activeKey) return;
    try {
      const { ciphertext, iv } = await encryptZeroKnowledgePayload(newSecrets, activeKey);
      localStorage.setItem(
        STORAGE_KEY_ENCRYPTED_SECRETS,
        JSON.stringify({
          version: 2,
          iv,
          ciphertext,
          updatedAt: new Date().toISOString(),
        })
      );
    } catch (e) {
      console.error('Error encrypting secrets to storage', e);
    }
  };

  // Encrypts the audit logs array with AES-256-GCM before saving to localStorage
  const persistEncryptedAuditLogs = async (
    newLogs: SecretAuditLogEntry[],
    activeKey: CryptoKey | null = masterKey
  ) => {
    setAuditLogs(newLogs);
    if (!activeKey) return;
    try {
      const { ciphertext, iv } = await encryptZeroKnowledgePayload(newLogs, activeKey);
      localStorage.setItem(
        STORAGE_KEY_ENCRYPTED_AUDIT,
        JSON.stringify({
          version: 2,
          iv,
          ciphertext,
          updatedAt: new Date().toISOString(),
        })
      );
    } catch (e) {
      console.error('Error encrypting audit logs to storage', e);
    }
  };

  // Append an entry to the Audit Log (never logs secret values)
  const handleLogAudit = useCallback(
    (
      action: SecretAuditAction,
      targetLabel: string,
      targetId?: string,
      details?: string
    ) => {
      const entry: SecretAuditLogEntry = {
        id: `audit-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        timestamp: new Date().toISOString(),
        actor: 'Vault Owner',
        action,
        target_id: targetId,
        target_label: targetLabel,
        details,
      };
      setAuditLogs((prev) => {
        const next = [entry, ...prev].slice(0, 500);
        if (masterKey) {
          encryptZeroKnowledgePayload(next, masterKey)
            .then(({ ciphertext, iv }) => {
              localStorage.setItem(
                STORAGE_KEY_ENCRYPTED_AUDIT,
                JSON.stringify({
                  version: 2,
                  iv,
                  ciphertext,
                  updatedAt: new Date().toISOString(),
                })
              );
            })
            .catch(() => {});
        }
        return next;
      });
    },
    [masterKey]
  );

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
  }, [isLocked, masterKey, securityConfig, showToast]);

  const lockVault = () => {
    setMasterKey(null);
    setAccounts([]);
    setSecrets([]);
    setAuditLogs([]);
    setSelectedAccount(null);
    setIsFormOpen(false);
    setIsLocked(true);
    setLastVerifiedAt(0);
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      navigator.vibrate(50);
    }
  };

  // Step-up verification within 60s for Reveal & Copy in API Keys & Secrets
  const verifyStepUpPassphrase = async (passphrase: string): Promise<boolean> => {
    if (!salt) return false;
    try {
      const storedVerifier = localStorage.getItem(STORAGE_KEY_VERIFIER);
      const computedVerifier = await computePassphraseVerifier(passphrase, salt);
      if (storedVerifier && storedVerifier === computedVerifier) {
        setLastVerifiedAt(Date.now());
        return true;
      }
      return false;
    } catch {
      return false;
    }
  };

  const unlockVault = async (passphrase: string): Promise<boolean> => {
    if (!salt) return false;
    try {
      const storedVerifier = localStorage.getItem(STORAGE_KEY_VERIFIER);
      const computedVerifier = await computePassphraseVerifier(passphrase, salt);

      if (storedVerifier && storedVerifier !== computedVerifier) {
        return false;
      }

      const v2Key = await deriveKeyFromPassphrase(passphrase, salt, PBKDF2_ITERATIONS_V2);
      let activeKey = v2Key;
      let usedLegacyKey = false;

      // 1. Decrypt accounts payload (with fallback to 100k PBKDF2 if vault was encrypted with legacy iterations)
      const encryptedRaw = localStorage.getItem(STORAGE_KEY_ENCRYPTED_VAULT);
      let loadedAccounts: AccountRecord[] = [];
      if (encryptedRaw) {
        const parsed = JSON.parse(encryptedRaw);
        if (parsed.ciphertext && parsed.iv) {
          try {
            const decryptedAccounts = await decryptZeroKnowledgePayload<AccountRecord[]>(
              parsed.ciphertext,
              parsed.iv,
              v2Key
            );
            loadedAccounts = Array.isArray(decryptedAccounts) ? decryptedAccounts : [];
          } catch {
            const legacyKey = await deriveKeyFromPassphrase(
              passphrase,
              salt,
              PBKDF2_ITERATIONS_LEGACY
            );
            const decryptedAccounts = await decryptZeroKnowledgePayload<AccountRecord[]>(
              parsed.ciphertext,
              parsed.iv,
              legacyKey
            );
            loadedAccounts = Array.isArray(decryptedAccounts) ? decryptedAccounts : [];
            activeKey = legacyKey;
            usedLegacyKey = true;
          }
        }
      }

      // 2. Decrypt secrets payload
      const encryptedSecretsRaw = localStorage.getItem(STORAGE_KEY_ENCRYPTED_SECRETS);
      let loadedSecrets: SecretItem[] = [];
      if (encryptedSecretsRaw) {
        const parsedSecrets = JSON.parse(encryptedSecretsRaw);
        if (parsedSecrets.ciphertext && parsedSecrets.iv) {
          const decryptedSecrets = await decryptZeroKnowledgePayload<SecretItem[]>(
            parsedSecrets.ciphertext,
            parsedSecrets.iv,
            activeKey
          );
          loadedSecrets = Array.isArray(decryptedSecrets) ? decryptedSecrets : [];
        }
      }

      // 3. Decrypt audit logs payload
      const encryptedAuditRaw = localStorage.getItem(STORAGE_KEY_ENCRYPTED_AUDIT);
      let loadedAudit: SecretAuditLogEntry[] = [];
      if (encryptedAuditRaw) {
        const parsedAudit = JSON.parse(encryptedAuditRaw);
        if (parsedAudit.ciphertext && parsedAudit.iv) {
          const decryptedAudit = await decryptZeroKnowledgePayload<SecretAuditLogEntry[]>(
            parsedAudit.ciphertext,
            parsedAudit.iv,
            activeKey
          );
          loadedAudit = Array.isArray(decryptedAudit) ? decryptedAudit : [];
        }
      }

      // Upgrade key derivation to 600k iterations if unlocked from a legacy 100k vault
      const finalKey = v2Key;
      if (usedLegacyKey) {
        await persistEncryptedAccounts(loadedAccounts, finalKey);
        await persistEncryptedSecrets(loadedSecrets, finalKey);
        await persistEncryptedAuditLogs(loadedAudit, finalKey);
      } else {
        setAccounts(loadedAccounts);
        setSecrets(loadedSecrets);
        setAuditLogs(loadedAudit);
        syncSecretMetadataToServer(loadedSecrets);
      }

      setMasterKey(finalKey);
      setIsLocked(false);
      setIsPrivacyBlurred(false);
      setLastVerifiedAt(Date.now());
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

    const key = await deriveKeyFromPassphrase(passphrase, newSalt, PBKDF2_ITERATIONS_V2);
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
    const initialSecrets = options?.loadDemo ? await createDemoSecretItems(key) : [];

    await persistEncryptedAccounts(initialAccounts, key);
    await persistEncryptedSecrets(initialSecrets, key);
    await persistEncryptedAuditLogs([], key);

    setHasExistingMaster(true);
    setIsLocked(false);
    setLastVerifiedAt(Date.now());
    showToast(
      options?.loadDemo
        ? 'Encrypted vault initialized with demo accounts & SaaS secrets.'
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

  const handleLoadDemoSecrets = async () => {
    if (!masterKey) return;
    const demoItems = await createDemoSecretItems(masterKey);
    const existingIds = new Set(secrets.map((s) => s.id));
    const merged = [...secrets, ...demoItems.filter((d) => !existingIds.has(d.id))];
    await persistEncryptedSecrets(merged, masterKey);
    handleLogAudit('create', 'Demo SaaS API Keys & Secrets Bundle', undefined, `Loaded ${demoItems.length} sample secrets`);
    showToast('Sample SaaS API Keys & Secrets encrypted into vault.');
  };

  const seedAccountIds = useMemo(() => new Set(INITIAL_SEED_ACCOUNTS.map((a) => a.id)), []);
  const demoAccountsCount = useMemo(
    () => accounts.filter((a) => seedAccountIds.has(a.id)).length,
    [accounts, seedAccountIds]
  );
  const demoSecretsCount = useMemo(
    () => secrets.filter((s) => DEMO_SECRET_IDS.includes(s.id)).length,
    [secrets]
  );
  const hasDemoData = demoAccountsCount > 0 || demoSecretsCount > 0;

  const handleClearAllDemoData = async () => {
    if (!masterKey) return;
    if (demoAccountsCount > 0) {
      const cleanedAccounts = accounts.filter((a) => !seedAccountIds.has(a.id));
      await persistEncryptedAccounts(cleanedAccounts, masterKey);
    }
    if (demoSecretsCount > 0) {
      const cleanedSecrets = secrets.filter((s) => !DEMO_SECRET_IDS.includes(s.id));
      await persistEncryptedSecrets(cleanedSecrets, masterKey);
      handleLogAudit('delete', 'Demo Sandbox Purge', undefined, 'Deleted all demo accounts and demo API keys');
    }
    showToast('All demo accounts and demo API keys have been deleted.');
  };

  // Language switch
  const handleLanguageChange = (lang: SupportedLanguage) => {
    setCurrentLanguage(lang);
    localStorage.setItem(STORAGE_KEY_LANG, lang);
  };

  // Theme switch
  const toggleThemeMode = () => {
    const next = themeMode === 'dark' ? 'light' : 'dark';
    setThemeMode(next);
    localStorage.setItem(STORAGE_KEY_THEME, next);
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

  // Export Encrypted Full Backup (Accounts + Secrets + Audit Logs)
  const handleExportBackup = async (): Promise<{ json: string; filename: string } | null> => {
    if (!masterKey || !salt) {
      showToast('Unlock vault first to export.');
      return null;
    }
    try {
      const bundle = {
        accounts,
        secrets,
        auditLogs,
      };
      const jsonBackup = await createEncryptedVaultBackup(bundle, masterKey, salt);
      const filename = `krypton_vault_backup_${new Date().toISOString().split('T')[0]}.json`;

      // Trigger standard file download on desktop browsers (ignored harmlessly in Android WebView)
      try {
        const blob = new Blob([jsonBackup], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 3000);
      } catch {
        // Standalone Android WebView handles export via Share Sheet / Copy Drawer
      }

      handleLogAudit('copy', 'Offline AES-256-GCM Backup File', undefined, `Exported ${accounts.length} accounts & ${secrets.length} secrets`);
      showToast('Encrypted vault backup ready to save or share.');
      return { json: jsonBackup, filename };
    } catch {
      showToast('Backup export failed.');
      return null;
    }
  };

  // Helper to apply restored data (either legacy AccountRecord[] or { accounts, secrets, auditLogs })
  const applyRestoredVaultPayload = async (data: unknown): Promise<boolean> => {
    if (Array.isArray(data)) {
      await persistEncryptedAccounts(data as AccountRecord[]);
      showToast(`Restored ${data.length} accounts from encrypted backup!`);
      return true;
    }
    if (data && typeof data === 'object' && 'accounts' in data) {
      const bundle = data as {
        accounts?: AccountRecord[];
        secrets?: SecretItem[];
        auditLogs?: SecretAuditLogEntry[];
      };
      if (Array.isArray(bundle.accounts)) {
        await persistEncryptedAccounts(bundle.accounts);
      }
      if (Array.isArray(bundle.secrets)) {
        await persistEncryptedSecrets(bundle.secrets);
      }
      if (Array.isArray(bundle.auditLogs)) {
        await persistEncryptedAuditLogs(bundle.auditLogs);
      }
      showToast(
        `Restored ${bundle.accounts?.length || 0} accounts & ${bundle.secrets?.length || 0} secrets!`
      );
      return true;
    }
    return false;
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
        return await applyRestoredVaultPayload(data);
      }

      // Try decrypting with current active masterKey if salt matches
      if (masterKey && salt && parsed.salt === bufferToBase64(salt)) {
        const data = await decryptZeroKnowledgePayload<unknown>(
          parsed.ciphertext,
          parsed.iv,
          masterKey
        );
        return await applyRestoredVaultPayload(data);
      }
      return false;
    } catch {
      return false;
    }
  };

  // Push Zero-Knowledge Encrypted Cloud Sync (Directly to Permanent Firebase Firestore + Server Relay)
  const handlePushCloudSync = async (syncId: string): Promise<boolean> => {
    if (!masterKey || !salt) return false;
    try {
      const bundle = { accounts, secrets, auditLogs };
      const { ciphertext, iv } = await encryptZeroKnowledgePayload(bundle, masterKey);
      const saltB64 = bufferToBase64(salt);

      let updatedAt = new Date().toISOString();

      // 1. Push directly to Firebase Firestore /vault_sync/{syncId}
      const firestoreRes = await pushFirestoreSyncChannel(syncId, {
        salt: saltB64,
        iv,
        ciphertext,
      });
      updatedAt = firestoreRes.updatedAt;

      // 2. If signed in with Google, also push to authenticated /user_vaults/{uid}
      if (auth.currentUser) {
        try {
          await pushAuthenticatedUserVault({ salt: saltB64, iv, ciphertext });
        } catch {
          // Non-fatal if user_vaults write fails
        }
      }

      // 3. Also notify server cache
      fetch('/api/sync/push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          syncId: firestoreRes.syncId,
          salt: saltB64,
          iv,
          ciphertext,
        }),
      }).catch(() => {});

      const updatedCfg: VaultSecurityConfig = {
        ...securityConfig,
        syncVaultId: firestoreRes.syncId,
        lastSyncedAt: updatedAt,
      };
      setSecurityConfig(updatedCfg);
      localStorage.setItem(STORAGE_KEY_CONFIG, JSON.stringify(updatedCfg));
      showToast('Encrypted vault permanently synced to Firebase Firestore.');
      return true;
    } catch (e) {
      console.error('Firestore cloud push error:', e);
      return false;
    }
  };

  // Pull Zero-Knowledge Encrypted Cloud Sync (Directly from Permanent Firebase Firestore)
  const handlePullCloudSync = async (
    syncId: string,
    passphrase?: string
  ): Promise<boolean> => {
    try {
      let record = await pullFirestoreSyncChannel(syncId);

      // If not found by syncId and user is signed in with Google, check their /user_vaults/{uid}
      if (!record && auth.currentUser) {
        try {
          record = await pullAuthenticatedUserVault();
        } catch {
          // Ignore
        }
      }

      // Fallback to server endpoint if needed
      if (!record) {
        const res = await fetch(`/api/sync/pull/${encodeURIComponent(syncId)}`);
        if (res.ok) {
          record = await res.json();
        }
      }

      if (!record || !record.salt || !record.iv || !record.ciphertext) return false;

      if (passphrase) {
        const remoteSalt = base64ToBuffer(record.salt);
        try {
          const remoteKey = await deriveKeyFromPassphrase(
            passphrase,
            remoteSalt,
            PBKDF2_ITERATIONS_V2
          );
          const decrypted = await decryptZeroKnowledgePayload<unknown>(
            record.ciphertext,
            record.iv,
            remoteKey
          );
          return await applyRestoredVaultPayload(decrypted);
        } catch {
          const legacyKey = await deriveKeyFromPassphrase(
            passphrase,
            remoteSalt,
            PBKDF2_ITERATIONS_LEGACY
          );
          const decrypted = await decryptZeroKnowledgePayload<unknown>(
            record.ciphertext,
            record.iv,
            legacyKey
          );
          return await applyRestoredVaultPayload(decrypted);
        }
      }

      if (masterKey && salt && record.salt === bufferToBase64(salt)) {
        const decrypted = await decryptZeroKnowledgePayload<unknown>(
          record.ciphertext,
          record.iv,
          masterKey
        );
        return await applyRestoredVaultPayload(decrypted);
      }
      return false;
    } catch {
      return false;
    }
  };

  // Helper to classify Mobile Wallets (e.g. Telebirr, M-Pesa, CBEBirr) vs Bank Accounts
  const isWalletAccount = useCallback((a: AccountRecord): boolean => {
    const combined = `${a.orgName || ''} ${a.name || ''}`.toLowerCase();
    const walletKeywords = [
      'telebirr',
      'wallet',
      'mpesa',
      'm-pesa',
      'cbebirr',
      'amole',
      'ebirr',
      'hellocash',
      'kacha',
    ];
    if (walletKeywords.some((kw) => combined.includes(kw))) {
      return true;
    }
    return !a.atm?.hasAtm;
  }, []);

  const bankAccountsCount = useMemo(
    () => accounts.filter((a) => !isWalletAccount(a)).length,
    [accounts, isWalletAccount]
  );

  const walletAccountsCount = useMemo(
    () => accounts.filter((a) => isWalletAccount(a)).length,
    [accounts, isWalletAccount]
  );

  // Safe Search Filtered Accounts (SECURITY LAW 2: PIN fields are strictly ignored)
  const filteredAccounts = useMemo(() => {
    let result = safeSearchAccounts(accounts, searchQuery);
    if (selectedFilter === 'bank') {
      result = result.filter((a) => !isWalletAccount(a));
    } else if (selectedFilter === 'wallet') {
      result = result.filter((a) => isWalletAccount(a));
    }
    return result;
  }, [accounts, searchQuery, selectedFilter, isWalletAccount]);

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

  // Secrets urgency summary badge count for sidebar/header
  const secretsDueCount = useMemo(() => {
    return secrets.filter((s) => {
      const u = evaluateSecretUrgency(s, 14);
      return u.level === 'overdue' || u.level === 'due_soon';
    }).length;
  }, [secrets]);

  const navItems: {
    id: NavigationTab;
    label: string;
    sublabel: string;
    icon: React.ComponentType<{ className?: string }>;
    badge?: number;
  }[] = [
    {
      id: 'vault',
      label: t.tabs.vault,
      sublabel: `${accounts.length} accounts`,
      icon: Wallet,
    },
    {
      id: 'secrets',
      label: 'API Keys & Secrets',
      sublabel: `${secrets.filter((s) => s.status === 'active').length} active keys`,
      icon: KeyRound,
      badge: secretsDueCount > 0 ? secretsDueCount : undefined,
    },
    {
      id: 'cards',
      label: t.tabs.cards,
      sublabel: `${totalCards} virtual cards`,
      icon: CreditCard,
    },
    {
      id: 'finance',
      label: t.tabs.finance,
      sublabel: 'FX & Ledger',
      icon: PieChart,
    },
    {
      id: 'security',
      label: t.tabs.security,
      sublabel: 'Audit & Backups',
      icon: Shield,
    },
  ];

  return (
    <div
      className={`min-h-screen w-full max-w-full overflow-x-hidden flex flex-col font-sans selection:bg-emerald-500/30 selection:text-emerald-200 transition-colors ${
        themeMode === 'light'
          ? 'theme-light bg-slate-100 text-slate-900'
          : 'theme-dark bg-[#070b14] text-slate-100'
      }`}
    >
      <OfflineIndicator />

      {/* ================= SCREEN-BLUR PRIVACY SHIELD OVERLAY ================= */}
      {isPrivacyBlurred && !isLocked && (
        <div
          onClick={() => setIsPrivacyBlurred(false)}
          className={`fixed inset-0 z-[100] backdrop-blur-2xl flex flex-col items-center justify-center p-6 text-center cursor-pointer animate-fade-in transition-colors ${
            themeMode === 'light'
              ? 'bg-slate-100/95 text-slate-900'
              : 'bg-[#070b14]/95 text-slate-100'
          }`}
        >
          <div
            className={`w-16 h-16 rounded-2xl flex items-center justify-center mb-4 border ${
              themeMode === 'light'
                ? 'bg-emerald-500/15 border-emerald-600/30 text-emerald-700'
                : 'bg-emerald-500/15 border-emerald-500/30 text-emerald-400'
            }`}
          >
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
      <header className="sticky top-0 z-30 bg-[#070b14]/95 backdrop-blur-xl border-b border-slate-800/80 px-4 sm:px-6 py-3">
        <div className="max-w-[1440px] mx-auto flex items-center justify-between gap-2">
          {/* Zone 1: Brand Wordmark */}
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-700 flex items-center justify-center shadow-lg shadow-emerald-950/50 shrink-0">
              <Shield className="w-5 h-5 text-slate-950 stroke-[2.2]" />
            </div>
            <div className="min-w-0">
              <span className="text-base sm:text-lg font-extrabold tracking-tight text-slate-100 truncate block sm:inline">
                {t.appName}
              </span>
              <span className="hidden sm:inline-block ml-2.5 text-xs font-mono text-slate-400">
                · Zero-Knowledge AES-256-GCM
              </span>
            </div>
          </div>

          {/* Zone 2: Quick Top Navigation for Medium Screens (md to lg) */}
          <nav className="hidden md:flex lg:hidden items-center gap-4 text-xs font-semibold text-slate-400">
            {navItems.map((item) => (
              <button
                key={item.id}
                onClick={() => setCurrentTab(item.id)}
                className={`hover:text-white transition-colors whitespace-nowrap flex items-center gap-1.5 ${
                  currentTab === item.id ? 'text-emerald-400' : ''
                }`}
              >
                <span>{item.label}</span>
                {item.badge !== undefined && (
                  <span className="px-1.5 py-0.5 rounded-md bg-amber-500/20 text-amber-300 text-[10px] font-mono">
                    {item.badge}
                  </span>
                )}
              </button>
            ))}
          </nav>

          {/* Zone 3: Primary Action & Utility Controls */}
          <div className="flex items-center gap-2 shrink-0">
            {/* Desktop/Tablet Controls (hidden on mobile, moved to Burger Menu on mobile) */}
            <div className="hidden md:flex items-center gap-2">
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

              {/* Theme Mode Toggle */}
              <button
                type="button"
                onClick={toggleThemeMode}
                aria-label="Toggle theme mode"
                className="p-2 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 transition-colors"
                title={themeMode === 'dark' ? 'Switch to Light Theme' : 'Switch to Obsidian Dark Theme'}
              >
                {themeMode === 'dark' ? (
                  <Sun className="w-4 h-4 text-amber-400" />
                ) : (
                  <Moon className="w-4 h-4 text-emerald-400" />
                )}
              </button>

              {/* PWA Install Button */}
              <PWAInstallButton />
            </div>

            {/* Lock Vault Button (Always visible) */}
            <button
              type="button"
              onClick={lockVault}
              aria-label="Lock Vault Now"
              className="p-2 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 transition-colors flex items-center gap-1.5"
              title="Lock Vault"
            >
              <Lock className="w-4 h-4 text-emerald-400" />
              <span className="hidden sm:inline text-xs font-semibold text-slate-200">Lock</span>
            </button>

            {/* Mobile Burger Menu Button (< md) */}
            <button
              type="button"
              onClick={() => setIsMobileMenuOpen((prev) => !prev)}
              aria-label="Open mobile settings menu"
              className="md:hidden p-2 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-200 transition-colors"
            >
              {isMobileMenuOpen ? (
                <X className="w-4 h-4 text-emerald-400" />
              ) : (
                <Menu className="w-4 h-4 text-slate-300" />
              )}
            </button>
          </div>
        </div>

        {/* Mobile Dropdown Burger Menu (< md) */}
        {isMobileMenuOpen && (
          <div className="md:hidden mt-3 pt-3 border-t border-slate-800/80 space-y-3 animate-fade-in">
            <div className="grid grid-cols-2 gap-2.5">
              {/* Base Currency */}
              <div className="p-2.5 rounded-xl bg-slate-900/90 border border-slate-800">
                <label className="block text-[10px] font-mono text-slate-400 mb-1">
                  Base Currency
                </label>
                <select
                  aria-label="Mobile select base currency"
                  value={exchangeConfig.baseCurrency}
                  onChange={(e) => {
                    handleUpdateExchangeConfig({
                      ...exchangeConfig,
                      baseCurrency: e.target.value,
                    });
                    setBalanceCycleIndex(0);
                  }}
                  className="w-full px-2 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-xs font-mono font-semibold text-emerald-400 focus:outline-none"
                >
                  <option value="ETB">ETB (Birr)</option>
                  <option value="USD">USD ($)</option>
                  <option value="EUR">EUR (€)</option>
                  <option value="GBP">GBP (£)</option>
                </select>
              </div>

              {/* Language */}
              <div className="p-2.5 rounded-xl bg-slate-900/90 border border-slate-800">
                <label className="block text-[10px] font-mono text-slate-400 mb-1">
                  Language
                </label>
                <select
                  aria-label="Mobile select language"
                  value={currentLanguage}
                  onChange={(e) => handleLanguageChange(e.target.value as SupportedLanguage)}
                  className="w-full px-2 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-xs font-medium text-slate-200 focus:outline-none"
                >
                  <option value="en">English (EN)</option>
                  <option value="am">አማርኛ (Amharic)</option>
                  <option value="om">Afaan Oromoo</option>
                  <option value="fr">Français (FR)</option>
                  <option value="es">Español (ES)</option>
                </select>
              </div>
            </div>

            <div className="flex items-center justify-between gap-2 pt-1">
              <button
                type="button"
                onClick={toggleThemeMode}
                className="flex-1 py-2.5 px-3 rounded-xl bg-slate-900 border border-slate-800 text-xs font-semibold text-slate-200 flex items-center justify-center gap-2"
              >
                {themeMode === 'dark' ? (
                  <>
                    <Sun className="w-4 h-4 text-amber-400" />
                    <span>Switch to Light Theme</span>
                  </>
                ) : (
                  <>
                    <Moon className="w-4 h-4 text-emerald-400" />
                    <span>Switch to Obsidian Dark</span>
                  </>
                )}
              </button>

              <PWAInstallButton />
            </div>
          </div>
        )}
      </header>

      {/* ================= 2. DESKTOP SIDEBAR + MAIN WORKSPACE ================= */}
      <div className="flex-1 max-w-[1440px] w-full mx-auto flex gap-6 px-3 sm:px-6 py-5 overflow-x-hidden">
        {/* Desktop Left Sidebar Navigation */}
        <aside className="hidden lg:flex w-64 shrink-0 flex-col justify-between self-start sticky top-20 rounded-3xl bg-[#0b111e] border border-slate-800/80 p-3.5 shadow-xl">
          <div className="space-y-1.5">
            <div className="px-3 py-2">
              <p className="text-[10px] font-mono uppercase tracking-wider text-slate-500">
                Vault Modules
              </p>
            </div>
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = currentTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setCurrentTab(item.id)}
                  className={`w-full flex items-center justify-between px-3.5 py-3 rounded-2xl text-left transition-all ${
                    isActive
                      ? 'bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 shadow-sm'
                      : 'text-slate-300 hover:bg-slate-900/80 hover:text-white border border-transparent'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div
                      className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${
                        isActive
                          ? 'bg-emerald-500/20 text-emerald-300'
                          : 'bg-slate-900 text-slate-400'
                      }`}
                    >
                      <Icon className="w-4 h-4" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-bold truncate">{item.label}</p>
                      <p className="text-[10px] font-mono text-slate-500 truncate">
                        {item.sublabel}
                      </p>
                    </div>
                  </div>
                  {item.badge !== undefined && (
                    <span
                      className="px-2 py-0.5 rounded-lg bg-amber-500/20 border border-amber-500/30 text-amber-300 text-[10px] font-mono font-bold flex items-center gap-1"
                      title="Secrets overdue or due for rotation within 14 days"
                    >
                      <AlertTriangle className="w-3 h-3" />
                      {item.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Cryptographic Status Card in Sidebar */}
          <div className="mt-6 pt-4 border-t border-slate-800/80 px-2 space-y-2">
            <div className="p-3 rounded-2xl bg-slate-950/90 border border-slate-800/80 space-y-1.5">
              <div className="flex items-center justify-between text-[10px] font-mono">
                <span className="text-slate-400">KDF Standard</span>
                <span className="text-emerald-400 font-semibold">PBKDF2 600k</span>
              </div>
              <div className="flex items-center justify-between text-[10px] font-mono">
                <span className="text-slate-400">Cipher</span>
                <span className="text-slate-200">AES-256-GCM</span>
              </div>
              <div className="flex items-center justify-between text-[10px] font-mono">
                <span className="text-slate-400">SaaS Secrets</span>
                <span className="text-cyan-400">{secrets.length} items</span>
              </div>
            </div>
          </div>
        </aside>

        {/* Main Content Area */}
        <main className="flex-1 min-w-0">
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

                {/* Stat 3: SaaS API Keys & Secrets */}
                <button
                  type="button"
                  onClick={() => setCurrentTab('secrets')}
                  className="p-4 rounded-2xl bg-gradient-to-br from-slate-900 via-slate-900/90 to-slate-950 border border-slate-800/80 hover:border-emerald-500/40 text-left transition-all"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-mono text-slate-400">API Keys &amp; Secrets</span>
                    <KeyRound className="w-3.5 h-3.5 text-emerald-400" />
                  </div>
                  <p className="text-xl sm:text-2xl font-mono font-extrabold text-emerald-400 mt-1 tabular-nums">
                    {secrets.length}
                  </p>
                  <span className="text-[10px] text-slate-400 font-mono mt-1 block">
                    {secretsDueCount > 0
                      ? `${secretsDueCount} due for rotation`
                      : 'SaaS Vault Module →'}
                  </span>
                </button>

                {/* Stat 4: Zero-Knowledge Shield */}
                <div className="p-4 rounded-2xl bg-gradient-to-br from-slate-900 via-slate-900/90 to-slate-950 border border-emerald-500/20">
                  <span className="text-[10px] font-mono text-emerald-400">Storage Encryption</span>
                  <p className="text-lg font-bold text-slate-100 mt-1 flex items-center gap-1.5">
                    <Shield className="w-4 h-4 text-emerald-400" />
                    AES-256-GCM
                  </p>
                  <span className="text-[10px] text-slate-400 font-mono mt-1 block">
                    PBKDF2 600k Iterations
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
                    Banks ({bankAccountsCount})
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
                    Wallets ({walletAccountsCount})
                  </button>
                </div>

                {demoAccountsCount > 0 && (
                  <button
                    type="button"
                    onClick={handleClearAllDemoData}
                    className="h-11 px-3.5 rounded-2xl bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/30 text-rose-300 text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors shrink-0"
                    title="Remove all sample demo accounts and keys"
                  >
                    <Trash2 className="w-4 h-4 text-rose-400" />
                    <span>Delete Demo ({demoAccountsCount})</span>
                  </button>
                )}

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
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
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
                          ? 'Your Encrypted Account Vault is Empty'
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

          {/* TAB 2: API KEYS & SECRETS MODULE */}
          {currentTab === 'secrets' && (
            <SecretsVaultView
              secrets={secrets}
              onUpdateSecrets={(updated) => persistEncryptedSecrets(updated)}
              auditLogs={auditLogs}
              onLogAudit={handleLogAudit}
              masterKey={masterKey}
              lastVerifiedAt={lastVerifiedAt}
              onVerifyStepUp={verifyStepUpPassphrase}
              highlightedSecretId={highlightedSecretId}
              onClearHighlightedSecret={() => setHighlightedSecretId(null)}
              onLoadDemoSecrets={handleLoadDemoSecrets}
              showToast={showToast}
            />
          )}

          {/* TAB 3: VIRTUAL CARDS */}
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

          {/* TAB 4: FINANCE & LEDGER */}
          {currentTab === 'finance' && (
            <FinanceView
              accounts={accounts}
              onSelectAccount={(acc) => setSelectedAccount(acc)}
              onAddTransaction={handleAddTransaction}
              onDeleteTransaction={handleDeleteTransaction}
              currentLanguage={currentLanguage}
              exchangeConfig={exchangeConfig}
              onUpdateExchangeConfig={handleUpdateExchangeConfig}
              convertAmount={convertAmount}
            />
          )}

          {/* TAB 5: SECURITY & AUDIT */}
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
              onClearDemoData={handleClearAllDemoData}
              hasDemoData={hasDemoData}
              currentLanguage={currentLanguage}
            />
          )}
        </main>
      </div>

      {/* ================= 3. BOTTOM NAVIGATION (MOBILE) ================= */}
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

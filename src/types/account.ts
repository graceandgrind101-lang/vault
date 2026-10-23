/**
 * Krypton Vault - Core Data Schemas & Types
 * Enforces strict field constraints and zero-knowledge storage posture.
 */

export type SupportedLanguage = 'en' | 'am' | 'om' | 'fr' | 'es';

export type CardNetwork = 'visa' | 'mastercard' | 'amex' | 'ethswitch' | 'unionpay' | 'generic';

export interface TransactionRecord {
  id: string;
  accountId: string;
  amount: number;
  type: 'income' | 'expense';
  category: string;
  date: string;
  note?: string;
}

export interface AtmModule {
  hasAtm: boolean;
  atmNumber?: string;       // Masked in UI output by default (e.g., •••• •••• •••• 4821)
  cvv?: string;             // 3 or 4 digits, masked
  atmPin?: string;          // Masked in UI output
  expiry?: string;          // MM/YY
  cardNetwork?: CardNetwork;
}

export interface MobileBankingModule {
  hasMobileBanking: boolean;
  mobileBankingPin?: string; // Masked in UI output
  appIdentifier?: string;    // e.g., CBE Birr, Telebirr, Chase Mobile
  ussdCode?: string;         // e.g., *889#, *815#, *127#
}

export interface TotpModule {
  hasTotp?: boolean;
  secret?: string;           // Base32 secret for 2FA
  issuer?: string;
}

export interface AccountRecord {
  id: string;
  name: string;             // Required string
  accountNumber: string;    // Required string
  phoneNumber: string;      // Required string
  
  // ATM Module
  atm: AtmModule;
  
  // Mobile Banking Module
  mobileBanking: MobileBankingModule;
  
  // TOTP 2FA Module
  totp?: TotpModule;
  
  // Metadata
  orgName?: string;         // Bank or Organization Name
  branchName?: string;      // Origin Bank Branch Name
  currency: string;         // e.g. USD, ETB, EUR, GBP
  language: SupportedLanguage;
  memo?: string;            // Optional text field
  
  // Financial Tracking
  currentBalance: number;
  transactions: TransactionRecord[];
  
  // Zero-Knowledge Encrypted State
  isClientEncrypted?: boolean;
  encryptedBlob?: string;   // AES-GCM encrypted payload containing sensitive PINs/CVVs
  iv?: string;              // Base64 Initialization Vector
  
  // Timestamps
  createdAt: string;
  updatedAt: string;
}

export interface EncryptedVaultBackup {
  version: number;
  exportedAt: string;
  salt: string;
  iv: string;
  ciphertext: string;
  checksum?: string;
}

export interface ExchangeRatesConfig {
  baseCurrency: string; // e.g., 'ETB' or 'USD'
  // Value of 1 USD in target currencies (used for cross-conversion)
  ratesPerUsd: Record<string, number>;
}

export interface VaultSecurityConfig {
  autoLockMinutes: number;   // 1, 5, 15, or 0 (on tab blur)
  biometricEnabled: boolean;
  lockOnTabSwitch: boolean;
  hideScreenOnSwitch: boolean;
  syncVaultId?: string;
  lastSyncedAt?: string;
}

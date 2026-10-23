/**
 * Krypton Vault - Data Validation, Safe Search, & Masking Rules
 * Strict implementation of Security & Masking Laws.
 */

import { AccountRecord, CardNetwork } from '../types/account';

export interface ValidationResult {
  isValid: boolean;
  errors: Record<string, string>;
}

/**
 * Validates an account record according to strict field constraints:
 * - Name Input* (Required string)
 * - Account Number* (Required string)
 * - Phone Number* (Required string)
 * - ATM Module:
 *   - Has ATM (Boolean)
 *   - ATM Number, CVV, ATM PIN* (Required only if Has ATM is true)
 * - Mobile Banking Module:
 *   - Has Mobile Banking (Boolean)
 *   - Mobile Banking PIN* (Required only if Has Mobile Banking is true)
 */
export function validateAccountInput(data: Partial<AccountRecord>): ValidationResult {
  const errors: Record<string, string> = {};

  // 1. Name Input*
  if (!data.name || typeof data.name !== 'string' || data.name.trim().length === 0) {
    errors.name = 'Account Name is required.';
  } else if (data.name.trim().length > 64) {
    errors.name = 'Account Name cannot exceed 64 characters.';
  }

  // 2. Account Number*
  if (!data.accountNumber || typeof data.accountNumber !== 'string' || data.accountNumber.trim().length === 0) {
    errors.accountNumber = 'Account Number is required.';
  } else if (!/^[0-9A-Za-z\s-]{4,34}$/.test(data.accountNumber.trim())) {
    errors.accountNumber = 'Account Number must be between 4 and 34 alphanumeric characters.';
  }

  // 3. Phone Number*
  if (!data.phoneNumber || typeof data.phoneNumber !== 'string' || data.phoneNumber.trim().length === 0) {
    errors.phoneNumber = 'Phone Number is required.';
  } else if (!/^\+?[0-9\s\-()]{7,20}$/.test(data.phoneNumber.trim())) {
    errors.phoneNumber = 'Please provide a valid phone number format.';
  }

  // 4. ATM Module Validation (Supports Last-4-Digits-Only Reference Mode or Full Number)
  if (data.atm?.hasAtm) {
    const atmNumberClean = data.atm.atmNumber?.replace(/[\s•*-]+/g, '') || '';
    if (!atmNumberClean) {
      errors.atmNumber = 'Card Last 4 Digits (or Card Number) is required when ATM module is enabled.';
    } else if (!/^(\d{4}|\d{12,19})$/.test(atmNumberClean)) {
      errors.atmNumber = 'Enter only the last 4 digits (recommended) or 12–19 digits.';
    }

    const cvvClean = data.atm.cvv?.trim() || '';
    if (cvvClean && !/^\d{3,4}$/.test(cvvClean)) {
      errors.cvv = 'CVV must be 3 or 4 digits (or leave blank for safety).';
    }

    const atmPinClean = data.atm.atmPin?.trim() || '';
    if (!atmPinClean) {
      errors.atmPin = 'ATM PIN is required when ATM module is enabled.';
    } else if (!/^\d{4,8}$/.test(atmPinClean)) {
      errors.atmPin = 'ATM PIN must be between 4 and 8 digits.';
    }
  }

  // 5. Mobile Banking Module Validation
  if (data.mobileBanking?.hasMobileBanking) {
    const mobilePinClean = data.mobileBanking.mobileBankingPin?.trim() || '';
    if (!mobilePinClean) {
      errors.mobileBankingPin = 'Mobile Banking PIN is required when Mobile Banking is enabled.';
    } else if (!/^\d{4,8}$/.test(mobilePinClean)) {
      errors.mobileBankingPin = 'Mobile Banking PIN must be between 4 and 8 digits.';
    }
  }

  return {
    isValid: Object.keys(errors).length === 0,
    errors,
  };
}

/**
 * SECURITY LAW 2: SEARCH LOGIC
 * Allow search parameters on all fields (Name, Account Number, Org Name, Phone, Branch, Memo)
 * EXCEPT PIN fields.
 * Never query or log PIN fields in open-text searches!
 */
export function safeSearchAccounts(accounts: AccountRecord[], query: string): AccountRecord[] {
  if (!query || typeof query !== 'string') return accounts;
  const q = query.trim().toLowerCase();
  if (q.length === 0) return accounts;

  return accounts.filter((acc) => {
    // Only search safe metadata fields
    const nameMatch = acc.name?.toLowerCase().includes(q) ?? false;
    const accountNumMatch = acc.accountNumber?.toLowerCase().includes(q) ?? false;
    const orgMatch = acc.orgName?.toLowerCase().includes(q) ?? false;
    const phoneMatch = acc.phoneNumber?.toLowerCase().includes(q) ?? false;
    const branchMatch = acc.branchName?.toLowerCase().includes(q) ?? false;
    const memoMatch = acc.memo?.toLowerCase().includes(q) ?? false;
    const currencyMatch = acc.currency?.toLowerCase().includes(q) ?? false;

    // Card last 4 digits only (safe to search by last 4)
    const cardLast4 = acc.atm?.hasAtm && acc.atm.atmNumber ? acc.atm.atmNumber.slice(-4) : '';
    const cardLast4Match = cardLast4.length > 0 && q.length >= 2 && cardLast4.includes(q);

    // CRITICAL: NEVER inspect acc.atm.atmPin or acc.mobileBanking.mobileBankingPin or acc.atm.cvv!
    return nameMatch || accountNumMatch || orgMatch || phoneMatch || branchMatch || memoMatch || currencyMatch || cardLast4Match;
  });
}

/**
 * Detects card network based on prefix
 */
export function detectCardNetwork(cardNumber: string): CardNetwork {
  const clean = cardNumber.replace(/\D/g, '');
  if (/^4/.test(clean)) return 'visa';
  if (/^5[1-5]/.test(clean) || /^2[2-7]/.test(clean)) return 'mastercard';
  if (/^3[47]/.test(clean)) return 'amex';
  if (/^62/.test(clean)) return 'unionpay';
  if (/^506/.test(clean) || /^650/.test(clean)) return 'ethswitch';
  return 'generic';
}

/**
 * Masks ATM Card number showing only the last 4 digits: •••• •••• •••• 1234
 */
export function maskCardNumber(cardNumber?: string): string {
  if (!cardNumber) return '•••• •••• •••• ••••';
  const clean = cardNumber.replace(/\s+/g, '');
  if (clean.length < 4) return '••••';
  const last4 = clean.slice(-4);
  return `•••• •••• •••• ${last4}`;
}

/**
 * Formats 16-digit card number with standard 4-digit grouping
 */
export function formatCardNumber(value: string): string {
  const clean = value.replace(/\D/g, '').slice(0, 19);
  return clean.replace(/(\d{4})(?=\d)/g, '$1 ');
}

/**
 * Formats currency amount
 */
export function formatCurrency(amount: number, currency: string = 'USD'): string {
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency || 'USD',
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

/**
 * Evaluates PIN quality to alert the user of weak or repetitive PINs
 */
export function auditPinStrength(pin?: string): { score: number; label: string; warning?: string } {
  if (!pin) return { score: 0, label: 'None' };
  const clean = pin.trim();
  if (clean.length < 4) return { score: 1, label: 'Too Short', warning: 'PIN should be at least 4 digits.' };

  // Common weak patterns
  const repetitive = /^(\d)\1+$/.test(clean);
  const sequentialAsc = '0123456789012345'.includes(clean);
  const sequentialDesc = '9876543210987654'.includes(clean);
  const commonWeak = ['1234', '0000', '1111', '1212', '4321', '2580', '1990', '2000', '2020', '2024', '2025', '2026'];

  if (repetitive) {
    return { score: 1, label: 'Very Weak', warning: 'Repeated digits (e.g. 0000) are easily guessed.' };
  }
  if (sequentialAsc || sequentialDesc) {
    return { score: 1, label: 'Very Weak', warning: 'Sequential numbers (e.g. 1234) are high breach risks.' };
  }
  if (commonWeak.includes(clean)) {
    return { score: 2, label: 'Common PIN', warning: 'Frequently used PIN found in breach databases.' };
  }

  if (clean.length === 4) {
    return { score: 4, label: 'Good' };
  }
  return { score: 5, label: 'Strong (6+ digits)' };
}

/**
 * Smart Natural Language Parser: parses unformatted bank notes/SMS receipts
 * into the required schema without saving or leaking raw unencrypted secrets!
 */
export function parseRawAccountSnippet(text: string): Partial<AccountRecord> {
  const result: Partial<AccountRecord> = {
    atm: { hasAtm: false },
    mobileBanking: { hasMobileBanking: false },
    currency: 'USD',
    currentBalance: 0,
    language: 'en',
  };

  if (!text) return result;

  // 1. Account Number
  const accMatch = text.match(/(?:ac(?:count)?|acc|a\/c|no\.?|#)\s*[:#-]?\s*([A-Za-z0-9-]{6,24})/i);
  if (accMatch) {
    result.accountNumber = accMatch[1].trim();
  }

  // 2. Phone Number
  const phoneMatch = text.match(/(?:tel|phone|mobile|cell)\s*[:#-]?\s*(\+?[0-9\s\-()]{8,18})/i) ||
                     text.match(/(\+?\d{1,3}[-.\s]?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4})/);
  if (phoneMatch) {
    result.phoneNumber = phoneMatch[1].trim();
  }

  // 3. Balance
  const balanceMatch = text.match(/(?:bal(?:ance)?|total|current|amount)\s*[:#-]?\s*[$€£]?\s*([0-9,]+(?:\.[0-9]{2})?)/i) ||
                       text.match(/[$€£]\s*([0-9,]+(?:\.[0-9]{2})?)/);
  if (balanceMatch) {
    result.currentBalance = parseFloat(balanceMatch[1].replace(/,/g, ''));
  }

  // Currency
  if (/ETB|Birr/i.test(text)) result.currency = 'ETB';
  else if (/EUR|€/i.test(text)) result.currency = 'EUR';
  else if (/GBP|£/i.test(text)) result.currency = 'GBP';
  else if (/USD|\$/i.test(text)) result.currency = 'USD';

  // Bank / Org Name
  const banks = [
    'Chase', 'Bank of America', 'Wells Fargo', 'Citibank', 'Commercial Bank of Ethiopia',
    'CBE', 'Bank of Abyssinia', 'Awash Bank', 'Dashen Bank', 'Telebirr', 'Barclays', 'HSBC'
  ];
  for (const b of banks) {
    if (new RegExp(`\\b${b}\\b`, 'i').test(text)) {
      result.orgName = b;
      break;
    }
  }

  // ATM Card & PIN detection
  const cardMatch = text.match(/(?:card|atm)\s*(?:no|number)?\s*[:#-]?\s*([0-9\s]{13,23})/i);
  const pinMatch = text.match(/(?:atm\s*pin|pin)\s*[:#-]?\s*([0-9]{4,8})/i);
  const cvvMatch = text.match(/(?:cvv|cvc|security code)\s*[:#-]?\s*([0-9]{3,4})/i);

  if (cardMatch || pinMatch || /atm/i.test(text)) {
    result.atm = {
      hasAtm: true,
      atmNumber: cardMatch ? cardMatch[1].replace(/\s+/g, '') : '',
      atmPin: pinMatch ? pinMatch[1] : '',
      cvv: cvvMatch ? cvvMatch[1] : '',
      cardNetwork: cardMatch ? detectCardNetwork(cardMatch[1]) : 'generic',
    };
  }

  // Mobile Banking detection
  const mobilePinMatch = text.match(/(?:mobile|app)\s*pin\s*[:#-]?\s*([0-9]{4,8})/i);
  if (mobilePinMatch || /mobile banking|cbe birr|telebirr/i.test(text)) {
    result.mobileBanking = {
      hasMobileBanking: true,
      mobileBankingPin: mobilePinMatch ? mobilePinMatch[1] : '',
    };
  }

  // Name fallback
  const nameMatch = text.match(/(?:name|holder|title)\s*[:#-]?\s*([A-Za-z0-9\s]{2,40})/i);
  if (nameMatch) {
    result.name = nameMatch[1].trim();
  } else if (result.orgName) {
    result.name = `${result.orgName} Account`;
  }

  return result;
}

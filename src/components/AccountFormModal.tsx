import React, { useState, useEffect, useRef } from 'react';
import {
  Shield,
  Eye,
  EyeOff,
  Sparkles,
  CreditCard,
  Smartphone,
  Building2,
  DollarSign,
  KeyRound,
  Camera,
  Loader2,
  PhoneCall,
} from 'lucide-react';
import { AccountRecord, SupportedLanguage } from '../types/account';
import { validateAccountInput, parseRawAccountSnippet, detectCardNetwork } from '../utils/validator';
import { BottomSheet } from './BottomSheet';
import { translations } from '../utils/i18n';

interface AccountFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (account: Partial<AccountRecord>) => void;
  initialAccount?: AccountRecord | null;
  currentLanguage: SupportedLanguage;
}

const ETHIOPIAN_USSD_PRESETS = [
  { label: 'CBE (*889#)', code: '*889#', app: 'CBE Birr / Mobile' },
  { label: 'Abyssinia (*815#)', code: '*815#', app: 'BoA Apollo / Mobile' },
  { label: 'Telebirr (*127#)', code: '*127#', app: 'Telebirr SuperApp' },
  { label: 'Awash (*901#)', code: '*901#', app: 'AwashBirr Pro' },
  { label: 'Dashen (*805#)', code: '*805#', app: 'Amole / Dashen SuperApp' },
  { label: 'Coopbank (*847#)', code: '*847#', app: 'Coopay-Ebirr' },
];

export const AccountFormModal: React.FC<AccountFormModalProps> = ({
  isOpen,
  onClose,
  onSave,
  initialAccount,
  currentLanguage,
}) => {
  const t = translations[currentLanguage];

  const [name, setName] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [orgName, setOrgName] = useState('');
  const [branchName, setBranchName] = useState('');
  const [currency, setCurrency] = useState('ETB');
  const [language, setLanguage] = useState<SupportedLanguage>(currentLanguage);
  const [memo, setMemo] = useState('');
  const [currentBalance, setCurrentBalance] = useState<number>(0);

  // ATM Module state
  const [hasAtm, setHasAtm] = useState(false);
  const [atmNumber, setAtmNumber] = useState('');
  const [cvv, setCvv] = useState('');
  const [atmPin, setAtmPin] = useState('');
  const [expiry, setExpiry] = useState('');
  const [showAtmPin, setShowAtmPin] = useState(false);
  const [showCvv, setShowCvv] = useState(false);

  // Mobile Banking state
  const [hasMobileBanking, setHasMobileBanking] = useState(false);
  const [mobileBankingPin, setMobileBankingPin] = useState('');
  const [appIdentifier, setAppIdentifier] = useState('');
  const [ussdCode, setUssdCode] = useState('');
  const [showMobilePin, setShowMobilePin] = useState(false);

  // TOTP 2FA Module state
  const [hasTotp, setHasTotp] = useState(false);
  const [totpSecret, setTotpSecret] = useState('');
  const [totpIssuer, setTotpIssuer] = useState('');
  const [otpAuthUri, setOtpAuthUri] = useState('');

  // Smart Parser & AI Vision Scanner state
  const [showSmartPaste, setShowSmartPaste] = useState(false);
  const [rawPasteText, setRawPasteText] = useState('');
  const [pasteNotice, setPasteNotice] = useState<string | null>(null);
  const [isAiScanning, setIsAiScanning] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Validation errors
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (initialAccount) {
      setName(initialAccount.name || '');
      setAccountNumber(initialAccount.accountNumber || '');
      setPhoneNumber(initialAccount.phoneNumber || '');
      setOrgName(initialAccount.orgName || '');
      setBranchName(initialAccount.branchName || '');
      setCurrency(initialAccount.currency || 'ETB');
      setLanguage(initialAccount.language || currentLanguage);
      setMemo(initialAccount.memo || '');
      setCurrentBalance(initialAccount.currentBalance || 0);

      setHasAtm(initialAccount.atm?.hasAtm || false);
      setAtmNumber(initialAccount.atm?.atmNumber || '');
      setCvv(initialAccount.atm?.cvv || '');
      setAtmPin(initialAccount.atm?.atmPin || '');
      setExpiry(initialAccount.atm?.expiry || '');

      setHasMobileBanking(initialAccount.mobileBanking?.hasMobileBanking || false);
      setMobileBankingPin(initialAccount.mobileBanking?.mobileBankingPin || '');
      setAppIdentifier(initialAccount.mobileBanking?.appIdentifier || '');
      setUssdCode(initialAccount.mobileBanking?.ussdCode || '');

      setHasTotp(Boolean(initialAccount.totp?.hasTotp && initialAccount.totp?.secret));
      setTotpSecret(initialAccount.totp?.secret || '');
      setTotpIssuer(initialAccount.totp?.issuer || '');
    } else {
      resetForm();
    }
  }, [initialAccount, isOpen, currentLanguage]);

  const resetForm = () => {
    setName('');
    setAccountNumber('');
    setPhoneNumber('');
    setOrgName('');
    setBranchName('');
    setCurrency('ETB');
    setLanguage(currentLanguage);
    setMemo('');
    setCurrentBalance(0);
    setHasAtm(false);
    setAtmNumber('');
    setCvv('');
    setAtmPin('');
    setExpiry('');
    setHasMobileBanking(false);
    setMobileBankingPin('');
    setAppIdentifier('');
    setUssdCode('');
    setHasTotp(false);
    setTotpSecret('');
    setTotpIssuer('');
    setOtpAuthUri('');
    setShowSmartPaste(false);
    setRawPasteText('');
    setPasteNotice(null);
    setErrors({});
  };

  const handleSmartParse = () => {
    if (!rawPasteText.trim()) return;
    const parsed = parseRawAccountSnippet(rawPasteText);
    if (parsed.name) setName(parsed.name);
    if (parsed.accountNumber) setAccountNumber(parsed.accountNumber);
    if (parsed.phoneNumber) setPhoneNumber(parsed.phoneNumber);
    if (parsed.orgName) setOrgName(parsed.orgName);
    if (parsed.currency) setCurrency(parsed.currency);
    if (parsed.currentBalance !== undefined) setCurrentBalance(parsed.currentBalance);

    if (parsed.atm?.hasAtm) {
      setHasAtm(true);
      if (parsed.atm.atmNumber) setAtmNumber(parsed.atm.atmNumber);
      if (parsed.atm.cvv) setCvv(parsed.atm.cvv);
      if (parsed.atm.atmPin) setAtmPin(parsed.atm.atmPin);
    }

    if (parsed.mobileBanking?.hasMobileBanking) {
      setHasMobileBanking(true);
      if (parsed.mobileBanking.mobileBankingPin) {
        setMobileBankingPin(parsed.mobileBanking.mobileBankingPin);
      }
    }

    setPasteNotice('Parsed fields populated into secure form! Verify details below.');
    setTimeout(() => setPasteNotice(null), 4000);
  };

  const handleAiPhotoScan = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsAiScanning(true);
    setPasteNotice(null);

    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });

      const res = await fetch('/api/ai/scan-document', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageBase64: base64,
          mimeType: file.type || 'image/jpeg',
          rawText: rawPasteText,
          mode: 'account',
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'AI scan failed.');
      }

      if (data.name) setName(data.name);
      if (data.accountNumber) setAccountNumber(data.accountNumber);
      if (data.phoneNumber) setPhoneNumber(data.phoneNumber);
      if (data.orgName) setOrgName(data.orgName);
      if (data.branchName) setBranchName(data.branchName);
      if (data.currency && ['USD', 'ETB', 'EUR', 'GBP', 'CAD'].includes(data.currency.toUpperCase())) {
        setCurrency(data.currency.toUpperCase());
      }
      if (typeof data.currentBalance === 'number' && data.currentBalance > 0) {
        setCurrentBalance(data.currentBalance);
      }
      if (data.memo) setMemo((prev) => (prev ? `${prev}\n${data.memo}` : data.memo));
      if (data.hasAtm || data.atmNumber) {
        setHasAtm(true);
        if (data.atmNumber) setAtmNumber(data.atmNumber);
        if (data.expiry) setExpiry(data.expiry);
      }

      setPasteNotice('Gemini AI extracted document metadata! Enter your private PINs below.');
    } catch (err: any) {
      setPasteNotice(`AI Scan Notice: ${err.message || 'Could not scan image.'}`);
    } finally {
      setIsAiScanning(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleParseOtpAuthUri = (uri: string) => {
    setOtpAuthUri(uri);
    if (!uri.trim().startsWith('otpauth://')) return;
    try {
      const url = new URL(uri.trim());
      const secretParam = url.searchParams.get('secret');
      const issuerParam = url.searchParams.get('issuer');
      if (secretParam) {
        setTotpSecret(secretParam.toUpperCase().replace(/\s+/g, ''));
      }
      if (issuerParam) {
        setTotpIssuer(issuerParam);
      } else {
        const pathLabel = decodeURIComponent(url.pathname.replace(/^\/\/totp\//, '').replace(/^\//, ''));
        if (pathLabel.includes(':')) {
          setTotpIssuer(pathLabel.split(':')[0]);
        }
      }
    } catch {
      // Ignore malformed URI
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const cleanTotpSecret = totpSecret.toUpperCase().replace(/[^A-Z2-7]/g, '');

    const candidateAccount: Partial<AccountRecord> = {
      name: name.trim(),
      accountNumber: accountNumber.trim(),
      phoneNumber: phoneNumber.trim(),
      orgName: orgName.trim(),
      branchName: branchName.trim(),
      currency,
      language,
      memo: memo.trim(),
      currentBalance: Number(currentBalance) || 0,
      atm: {
        hasAtm,
        atmNumber: hasAtm ? atmNumber.trim() : undefined,
        cvv: hasAtm ? cvv.trim() : undefined,
        atmPin: hasAtm ? atmPin.trim() : undefined,
        expiry: hasAtm ? expiry.trim() : undefined,
        cardNetwork: hasAtm && atmNumber ? detectCardNetwork(atmNumber) : undefined,
      },
      mobileBanking: {
        hasMobileBanking,
        mobileBankingPin: hasMobileBanking ? mobileBankingPin.trim() : undefined,
        appIdentifier: hasMobileBanking ? appIdentifier.trim() : undefined,
        ussdCode: hasMobileBanking ? ussdCode.trim() : undefined,
      },
      totp: hasTotp && cleanTotpSecret
        ? {
            hasTotp: true,
            secret: cleanTotpSecret,
            issuer: totpIssuer.trim() || orgName.trim() || 'Vault 2FA',
          }
        : { hasTotp: false },
      transactions: initialAccount?.transactions || [],
    };

    const validation = validateAccountInput(candidateAccount);
    if (!validation.isValid) {
      setErrors(validation.errors);
      return;
    }

    onSave(candidateAccount);
    onClose();
  };

  return (
    <BottomSheet
      isOpen={isOpen}
      onClose={onClose}
      title={initialAccount ? 'Edit Account' : t.newAccount}
      subtitle={t.tagline}
      maxHeight="max-h-[92vh]"
    >
      <form onSubmit={handleSubmit} className="space-y-5 pb-6">
        {/* Smart Paste & Gemini AI Vision Scanner Bar */}
        <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-3 space-y-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => setShowSmartPaste(!showSmartPaste)}
              className="flex items-center gap-2 text-left"
            >
              <Sparkles className="w-4 h-4 text-emerald-400 shrink-0" />
              <span className="text-xs font-semibold text-slate-200">
                Smart SMS Parser & AI Receipt/Card Scanner
              </span>
            </button>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={isAiScanning}
                className="px-2.5 py-1.5 rounded-xl bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/30 text-emerald-300 text-[11px] font-semibold flex items-center gap-1.5 transition-colors disabled:opacity-50"
              >
                {isAiScanning ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Camera className="w-3.5 h-3.5" />
                )}
                <span>{isAiScanning ? 'Scanning...' : 'Scan Receipt / Card (AI)'}</span>
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleAiPhotoScan}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => setShowSmartPaste(!showSmartPaste)}
                className="text-[11px] text-slate-400 hover:text-white font-medium px-1.5"
              >
                {showSmartPaste ? 'Hide SMS' : 'Paste SMS'}
              </button>
            </div>
          </div>

          {pasteNotice && (
            <p className="text-xs text-emerald-400 font-medium bg-emerald-500/10 border border-emerald-500/20 rounded-xl px-3 py-1.5">
              {pasteNotice}
            </p>
          )}

          {showSmartPaste && (
            <div className="pt-2 border-t border-slate-800/80 space-y-2">
              <textarea
                value={rawPasteText}
                onChange={(e) => setRawPasteText(e.target.value)}
                placeholder="e.g. CBE Alert: Account #100038492012 holder Abebe B. Phone: +251911234567. Bal: ETB 145,200.00..."
                rows={3}
                className="w-full text-xs bg-slate-950 border border-slate-700/80 rounded-xl p-2.5 text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
              />
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-slate-400">
                  Parses locally on device. Zero plaintext PIN leaks.
                </span>
                <button
                  type="button"
                  onClick={handleSmartParse}
                  className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium transition-colors"
                >
                  Auto-Populate Form
                </button>
              </div>
            </div>
          )}
        </div>

        {/* ================= SECTION 1: REQUIRED CORE IDENTIFIERS ================= */}
        <div className="space-y-3">
          <h4 className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
            <Building2 className="w-3.5 h-3.5 text-emerald-400" />
            Core Account Identifiers
          </h4>

          {/* Account Name */}
          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1">
              {t.accountName} <span className="text-emerald-400">*</span>
            </label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (errors.name) setErrors({ ...errors, name: '' });
              }}
              placeholder="e.g. Primary Business Checking, Personal Savings"
              className={`w-full h-11 px-3.5 rounded-xl bg-slate-900 border ${
                errors.name ? 'border-red-500' : 'border-slate-800'
              } text-slate-100 placeholder-slate-500 text-sm focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500`}
            />
            {errors.name && <p className="text-xs text-red-400 mt-1">{errors.name}</p>}
          </div>

          {/* Account Number & Phone Number Row */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">
                {t.accountNumber} <span className="text-emerald-400">*</span>
              </label>
              <input
                type="text"
                required
                value={accountNumber}
                onChange={(e) => {
                  setAccountNumber(e.target.value);
                  if (errors.accountNumber) setErrors({ ...errors, accountNumber: '' });
                }}
                placeholder="e.g. 100084920491"
                className={`w-full h-11 px-3.5 rounded-xl bg-slate-900 border ${
                  errors.accountNumber ? 'border-red-500' : 'border-slate-800'
                } text-slate-100 placeholder-slate-500 text-sm font-mono focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500`}
              />
              {errors.accountNumber && (
                <p className="text-xs text-red-400 mt-1">{errors.accountNumber}</p>
              )}
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">
                {t.phoneNumber} <span className="text-emerald-400">*</span>
              </label>
              <input
                type="tel"
                required
                value={phoneNumber}
                onChange={(e) => {
                  setPhoneNumber(e.target.value);
                  if (errors.phoneNumber) setErrors({ ...errors, phoneNumber: '' });
                }}
                placeholder="e.g. +251 911 234567"
                className={`w-full h-11 px-3.5 rounded-xl bg-slate-900 border ${
                  errors.phoneNumber ? 'border-red-500' : 'border-slate-800'
                } text-slate-100 placeholder-slate-500 text-sm font-mono focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500`}
              />
              {errors.phoneNumber && (
                <p className="text-xs text-red-400 mt-1">{errors.phoneNumber}</p>
              )}
            </div>
          </div>
        </div>

        {/* ================= SECTION 2: ATM MODULE ================= */}
        <div className="p-4 rounded-2xl bg-slate-900/60 border border-slate-800 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CreditCard className="w-4 h-4 text-emerald-400" />
              <div>
                <p className="text-xs font-semibold text-slate-200">{t.atmModule}</p>
                <p className="text-[10px] text-slate-400">Physical/virtual debit card & encrypted ATM PIN</p>
              </div>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={hasAtm}
                onChange={(e) => setHasAtm(e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-600"></div>
            </label>
          </div>

          {hasAtm && (
            <div className="space-y-3 pt-3 border-t border-slate-800/80 animate-fade-in">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  {t.atmCardNumber} <span className="text-emerald-400">*</span>
                </label>
                <input
                  type="text"
                  value={atmNumber}
                  onChange={(e) => {
                    setAtmNumber(e.target.value);
                    if (errors.atmNumber) setErrors({ ...errors, atmNumber: '' });
                  }}
                  placeholder="4111 2222 3333 4444"
                  maxLength={23}
                  className={`w-full h-11 px-3.5 rounded-xl bg-slate-950 border ${
                    errors.atmNumber ? 'border-red-500' : 'border-slate-700/80'
                  } text-slate-100 placeholder-slate-500 text-sm font-mono tracking-wider focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500`}
                />
                {errors.atmNumber && <p className="text-xs text-red-400 mt-1">{errors.atmNumber}</p>}
              </div>

              <div className="grid grid-cols-3 gap-2.5">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    {t.cvv} <span className="text-emerald-400">*</span>
                  </label>
                  <div className="relative">
                    <input
                      type={showCvv ? 'text' : 'password'}
                      value={cvv}
                      onChange={(e) => {
                        setCvv(e.target.value);
                        if (errors.cvv) setErrors({ ...errors, cvv: '' });
                      }}
                      placeholder="•••"
                      maxLength={4}
                      className={`w-full h-11 px-3 rounded-xl bg-slate-950 border ${
                        errors.cvv ? 'border-red-500' : 'border-slate-700/80'
                      } text-slate-100 placeholder-slate-500 text-sm font-mono text-center focus:outline-none focus:border-emerald-500`}
                    />
                    <button
                      type="button"
                      onClick={() => setShowCvv(!showCvv)}
                      aria-label="Toggle CVV visibility"
                      className="absolute right-2 top-3 text-slate-400 hover:text-white"
                    >
                      {showCvv ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                  {errors.cvv && <p className="text-[10px] text-red-400 mt-0.5">{errors.cvv}</p>}
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    {t.atmPin} <span className="text-emerald-400">*</span>
                  </label>
                  <div className="relative">
                    <input
                      type={showAtmPin ? 'text' : 'password'}
                      value={atmPin}
                      onChange={(e) => {
                        setAtmPin(e.target.value);
                        if (errors.atmPin) setErrors({ ...errors, atmPin: '' });
                      }}
                      placeholder="••••"
                      maxLength={8}
                      className={`w-full h-11 px-3 rounded-xl bg-slate-950 border ${
                        errors.atmPin ? 'border-red-500' : 'border-slate-700/80'
                      } text-slate-100 placeholder-slate-500 text-sm font-mono text-center focus:outline-none focus:border-emerald-500`}
                    />
                    <button
                      type="button"
                      onClick={() => setShowAtmPin(!showAtmPin)}
                      aria-label="Toggle ATM PIN visibility"
                      className="absolute right-2 top-3 text-slate-400 hover:text-white"
                    >
                      {showAtmPin ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                  {errors.atmPin && <p className="text-[10px] text-red-400 mt-0.5">{errors.atmPin}</p>}
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Expiry (MM/YY)
                  </label>
                  <input
                    type="text"
                    value={expiry}
                    onChange={(e) => setExpiry(e.target.value)}
                    placeholder="12/29"
                    maxLength={5}
                    className="w-full h-11 px-3 rounded-xl bg-slate-950 border border-slate-700/80 text-slate-100 placeholder-slate-500 text-sm font-mono text-center focus:outline-none focus:border-emerald-500"
                  />
                </div>
              </div>
            </div>
          )}
        </div>

        {/* ================= SECTION 3: MOBILE BANKING & USSD MODULE ================= */}
        <div className="p-4 rounded-2xl bg-slate-900/60 border border-slate-800 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Smartphone className="w-4 h-4 text-emerald-400" />
              <div>
                <p className="text-xs font-semibold text-slate-200">{t.mobileBankingModule}</p>
                <p className="text-[10px] text-slate-400">Mobile app PIN & Ethiopian USSD quick dialers</p>
              </div>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={hasMobileBanking}
                onChange={(e) => setHasMobileBanking(e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-600"></div>
            </label>
          </div>

          {hasMobileBanking && (
            <div className="space-y-3 pt-3 border-t border-slate-800/80 animate-fade-in">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    {t.mobileBankingPin} <span className="text-emerald-400">*</span>
                  </label>
                  <div className="relative">
                    <input
                      type={showMobilePin ? 'text' : 'password'}
                      value={mobileBankingPin}
                      onChange={(e) => {
                        setMobileBankingPin(e.target.value);
                        if (errors.mobileBankingPin) setErrors({ ...errors, mobileBankingPin: '' });
                      }}
                      placeholder="••••"
                      maxLength={8}
                      className={`w-full h-11 px-3.5 rounded-xl bg-slate-950 border ${
                        errors.mobileBankingPin ? 'border-red-500' : 'border-slate-700/80'
                      } text-slate-100 placeholder-slate-500 text-sm font-mono tracking-widest focus:outline-none focus:border-emerald-500`}
                    />
                    <button
                      type="button"
                      onClick={() => setShowMobilePin(!showMobilePin)}
                      aria-label="Toggle Mobile Banking PIN visibility"
                      className="absolute right-3 top-3 text-slate-400 hover:text-white"
                    >
                      {showMobilePin ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                  {errors.mobileBankingPin && (
                    <p className="text-xs text-red-400 mt-1">{errors.mobileBankingPin}</p>
                  )}
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    App / Service Name
                  </label>
                  <input
                    type="text"
                    value={appIdentifier}
                    onChange={(e) => setAppIdentifier(e.target.value)}
                    placeholder="e.g. CBE Birr, Telebirr"
                    className="w-full h-11 px-3.5 rounded-xl bg-slate-950 border border-slate-700/80 text-slate-100 placeholder-slate-500 text-sm focus:outline-none focus:border-emerald-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    USSD Dialer Code
                  </label>
                  <input
                    type="text"
                    value={ussdCode}
                    onChange={(e) => setUssdCode(e.target.value)}
                    placeholder="e.g. *889#"
                    className="w-full h-11 px-3.5 rounded-xl bg-slate-950 border border-slate-700/80 text-slate-100 placeholder-slate-500 text-sm font-mono focus:outline-none focus:border-emerald-500"
                  />
                </div>
              </div>

              {/* Quick Ethiopian USSD Preset Selector */}
              <div>
                <p className="text-[10px] text-slate-400 font-mono mb-1.5 flex items-center gap-1">
                  <PhoneCall className="w-3 h-3 text-emerald-400" />
                  Quick Fill Ethiopian Bank USSD:
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {ETHIOPIAN_USSD_PRESETS.map((preset) => (
                    <button
                      key={preset.code}
                      type="button"
                      onClick={() => {
                        setUssdCode(preset.code);
                        if (!appIdentifier) setAppIdentifier(preset.app);
                      }}
                      className={`px-2.5 py-1 rounded-lg text-[11px] font-mono transition-colors ${
                        ussdCode === preset.code
                          ? 'bg-emerald-600 text-white'
                          : 'bg-slate-950 border border-slate-800 text-slate-300 hover:border-emerald-500/40'
                      }`}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* ================= SECTION 4: 2FA / TOTP AUTHENTICATOR MODULE ================= */}
        <div className="p-4 rounded-2xl bg-slate-900/60 border border-slate-800 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <KeyRound className="w-4 h-4 text-emerald-400" />
              <div>
                <p className="text-xs font-semibold text-slate-200">2FA / TOTP Authenticator</p>
                <p className="text-[10px] text-slate-400">Generate live 6-digit RFC 6238 2FA codes offline</p>
              </div>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={hasTotp}
                onChange={(e) => setHasTotp(e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-600"></div>
            </label>
          </div>

          {hasTotp && (
            <div className="space-y-3 pt-3 border-t border-slate-800/80 animate-fade-in">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Base32 Secret Key <span className="text-emerald-400">*</span>
                  </label>
                  <input
                    type="text"
                    value={totpSecret}
                    onChange={(e) => setTotpSecret(e.target.value.toUpperCase())}
                    placeholder="e.g. JBSWY3DPEHPK3PXP"
                    className="w-full h-11 px-3.5 rounded-xl bg-slate-950 border border-slate-700/80 text-slate-100 placeholder-slate-500 text-xs font-mono tracking-wider focus:outline-none focus:border-emerald-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    2FA Issuer Label
                  </label>
                  <input
                    type="text"
                    value={totpIssuer}
                    onChange={(e) => setTotpIssuer(e.target.value)}
                    placeholder="e.g. Chase, Bank of Abyssinia"
                    className="w-full h-11 px-3.5 rounded-xl bg-slate-950 border border-slate-700/80 text-slate-100 placeholder-slate-500 text-sm focus:outline-none focus:border-emerald-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-mono text-slate-400 mb-1">
                  Or Paste otpauth:// URI to Auto-Extract Secret:
                </label>
                <input
                  type="text"
                  value={otpAuthUri}
                  onChange={(e) => handleParseOtpAuthUri(e.target.value)}
                  placeholder="otpauth://totp/Bank:User?secret=JBSWY3DPEHPK3PXP&issuer=Bank"
                  className="w-full h-9 px-3 rounded-xl bg-slate-950 border border-slate-800 text-slate-300 placeholder-slate-600 text-xs font-mono focus:outline-none focus:border-emerald-500"
                />
              </div>
            </div>
          )}
        </div>

        {/* ================= SECTION 5: METADATA & FINANCIAL TRACKING ================= */}
        <div className="space-y-3">
          <h4 className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
            <DollarSign className="w-3.5 h-3.5 text-emerald-400" />
            Institution & Balance Metadata
          </h4>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">
                {t.bankOrgName}
              </label>
              <input
                type="text"
                value={orgName}
                onChange={(e) => setOrgName(e.target.value)}
                placeholder="e.g. Commercial Bank of Ethiopia, Bank of Abyssinia, Telebirr"
                className="w-full h-11 px-3.5 rounded-xl bg-slate-900 border border-slate-800 text-slate-100 placeholder-slate-500 text-sm focus:outline-none focus:border-emerald-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">
                {t.originBranch}
              </label>
              <input
                type="text"
                value={branchName}
                onChange={(e) => setBranchName(e.target.value)}
                placeholder="e.g. Bole Medhanealem Branch"
                className="w-full h-11 px-3.5 rounded-xl bg-slate-900 border border-slate-800 text-slate-100 placeholder-slate-500 text-sm focus:outline-none focus:border-emerald-500"
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2.5">
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">Currency</label>
              <select
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                className="w-full h-11 px-3 rounded-xl bg-slate-900 border border-slate-800 text-slate-100 text-sm font-mono focus:outline-none focus:border-emerald-500"
              >
                <option value="ETB">ETB (Birr)</option>
                <option value="USD">USD ($)</option>
                <option value="EUR">EUR (€)</option>
                <option value="GBP">GBP (£)</option>
                <option value="CAD">CAD ($)</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">{t.currentBalance}</label>
              <input
                type="number"
                step="0.01"
                value={currentBalance}
                onChange={(e) => setCurrentBalance(parseFloat(e.target.value) || 0)}
                placeholder="0.00"
                className="w-full h-11 px-3 rounded-xl bg-slate-900 border border-slate-800 text-slate-100 font-mono text-sm focus:outline-none focus:border-emerald-500"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">{t.language}</label>
              <select
                value={language}
                onChange={(e) => setLanguage(e.target.value as SupportedLanguage)}
                className="w-full h-11 px-3 rounded-xl bg-slate-900 border border-slate-800 text-slate-100 text-sm focus:outline-none focus:border-emerald-500"
              >
                <option value="en">English</option>
                <option value="am">አማርኛ (Amharic)</option>
                <option value="om">Afaan Oromoo</option>
                <option value="fr">Français</option>
                <option value="es">Español</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1">{t.memo}</label>
            <textarea
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              rows={2}
              placeholder="Private memo, swift code, routing info, emergency contact..."
              className="w-full p-3 rounded-xl bg-slate-900 border border-slate-800 text-slate-100 placeholder-slate-500 text-xs focus:outline-none focus:border-emerald-500"
            />
          </div>
        </div>

        {/* Submit Actions */}
        <div className="pt-2 flex items-center justify-end gap-3 border-t border-slate-800">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2.5 rounded-xl border border-slate-700 hover:bg-slate-800 text-slate-300 text-xs font-medium transition-colors"
          >
            {t.cancel}
          </button>
          <button
            type="submit"
            className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-lg shadow-emerald-950 flex items-center gap-1.5 transition-all active:scale-95"
          >
            <Shield className="w-4 h-4" />
            <span>{t.saveAccount}</span>
          </button>
        </div>
      </form>
    </BottomSheet>
  );
};

import React, { useState, useEffect, useRef, useMemo } from 'react';
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
  Plus,
  X,
  Check,
} from 'lucide-react';
import { AccountRecord, SupportedLanguage } from '../types/account';
import { validateAccountInput, parseRawAccountSnippet, detectCardNetwork } from '../utils/validator';
import { BottomSheet } from './BottomSheet';
import { translations } from '../utils/i18n';
import { resolveApiUrl } from '../firebase';

interface AccountFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (account: Partial<AccountRecord>) => void;
  initialAccount?: AccountRecord | null;
  currentLanguage: SupportedLanguage;
}

interface InstitutionPreset {
  name: string;
  shortCode: string;
  category: 'Bank' | 'Wallet' | 'MFI / Gateway';
  ussd?: string;
  app?: string;
}

const CUSTOM_BANKS_STORAGE_KEY = 'krypton_custom_institutions_v1';

// Top 50+ Ethiopian Banks, Microfinance Institutions, Payment Gateways & Mobile Wallets
const ETHIOPIAN_FINANCIAL_INSTITUTIONS: InstitutionPreset[] = [
  // Major Commercial & Private Banks
  { name: 'Commercial Bank of Ethiopia (CBE)', shortCode: 'CBE', category: 'Bank', ussd: '*889#', app: 'CBE Mobile / CBEBirr' },
  { name: 'Bank of Abyssinia (BoA)', shortCode: 'BOA', category: 'Bank', ussd: '*815#', app: 'BoA Mobile / Apollo' },
  { name: 'Awash Bank', shortCode: 'AWASH', category: 'Bank', ussd: '*901#', app: 'AwashBirr Pro' },
  { name: 'Dashen Bank', shortCode: 'DASHEN', category: 'Bank', ussd: '*805#', app: 'Dashen SuperApp / Amole' },
  { name: 'Cooperative Bank of Oromia (Coopbank)', shortCode: 'COOP', category: 'Bank', ussd: '*847#', app: 'CoopApp / Coopay-Ebirr' },
  { name: 'Nib International Bank (NIB)', shortCode: 'NIB', category: 'Bank', ussd: '*855#', app: 'NIBTerara / Mobile' },
  { name: 'Hibret Bank (United Bank)', shortCode: 'HIBRET', category: 'Bank', ussd: '*811#', app: 'Hibir Mobile' },
  { name: 'Wegagen Bank', shortCode: 'WEGAGEN', category: 'Bank', ussd: '*866#', app: 'Wegagen Mobile' },
  { name: 'Oromia Bank', shortCode: 'OB', category: 'Bank', ussd: '*877#', app: 'Oromia Mobile' },
  { name: 'Zemen Bank', shortCode: 'ZEMEN', category: 'Bank', ussd: '*844#', app: 'Zemen OmniChannel' },
  { name: 'Bunna Bank', shortCode: 'BUNNA', category: 'Bank', ussd: '*858#', app: 'Bunna Mobile' },
  { name: 'Berhan Bank', shortCode: 'BERHAN', category: 'Bank', ussd: '*881#', app: 'Berhan Mobile' },
  { name: 'Abay Bank', shortCode: 'ABAY', category: 'Bank', ussd: '*812#', app: 'Abay Mobile' },
  { name: 'Lion International Bank (Anbessa)', shortCode: 'LIB', category: 'Bank', ussd: '*803#', app: 'Anbessa / HelloCash' },
  { name: 'Addis International Bank (AdIB)', shortCode: 'ADIB', category: 'Bank', ussd: '*871#', app: 'AdIB Mobile' },
  { name: 'Enat Bank', shortCode: 'ENAT', category: 'Bank', ussd: '*851#', app: 'Enat Mobile' },
  { name: 'Global Bank Ethiopia (Debub Global)', shortCode: 'GBE', category: 'Bank', ussd: '*834#', app: 'Global Bank Mobile' },
  { name: 'Amhara Bank (ABa)', shortCode: 'ABA', category: 'Bank', ussd: '*645#', app: 'ABa Mobile' },
  { name: 'Tsehay Bank', shortCode: 'TSEHAY', category: 'Bank', ussd: '*693#', app: 'Tsehay Mobile' },
  { name: 'Siinqee Bank', shortCode: 'SIINQEE', category: 'Bank', ussd: '*872#', app: 'Siinqee Mobile' },
  { name: 'Ahadu Bank', shortCode: 'AHADU', category: 'Bank', ussd: '*656#', app: 'Ahadu Mobile' },
  { name: 'Goh Betoch Bank', shortCode: 'GOH', category: 'Bank', ussd: '*662#', app: 'Goh Mobile' },
  { name: 'Tsedey Bank', shortCode: 'TSEDEY', category: 'Bank', ussd: '*969#', app: 'Tsedey Mobile' },
  { name: 'ZamZam Bank (Interest-Free)', shortCode: 'ZAMZAM', category: 'Bank', ussd: '*933#', app: 'ZamZam Mobile' },
  { name: 'Hijra Bank (Interest-Free)', shortCode: 'HIJRA', category: 'Bank', ussd: '*922#', app: 'HalalPay / Hijra Mobile' },
  { name: 'Rammis Bank (Interest-Free)', shortCode: 'RAMMIS', category: 'Bank', ussd: '*678#', app: 'Rammis Mobile' },
  { name: 'Shabelle Bank', shortCode: 'SHABELLE', category: 'Bank', ussd: '*896#', app: 'Shabelle / HelloCash' },
  { name: 'Gadaa Bank', shortCode: 'GADAA', category: 'Bank', ussd: '*642#', app: 'Gadaa Mobile' },
  { name: 'Omo Bank', shortCode: 'OMO', category: 'Bank', ussd: '*859#', app: 'Omo Bank Mobile' },
  { name: 'Sidama Bank', shortCode: 'SIDAMA', category: 'Bank', ussd: '*635#', app: 'Sidama Mobile' },
  { name: 'Siket Bank', shortCode: 'SIKET', category: 'Bank', ussd: '*681#', app: 'Siket Mobile' },
  { name: 'Development Bank of Ethiopia (DBE)', shortCode: 'DBE', category: 'Bank' },
  { name: 'National Bank of Ethiopia (NBE)', shortCode: 'NBE', category: 'Bank' },

  // Mobile Wallets & SuperApps
  { name: 'Telebirr (Ethio Telecom Wallet)', shortCode: 'TELEBIRR', category: 'Wallet', ussd: '*127#', app: 'Telebirr SuperApp' },
  { name: 'M-Pesa Ethiopia (Safaricom Wallet)', shortCode: 'MPESA', category: 'Wallet', ussd: '*733#', app: 'M-Pesa Safaricom' },
  { name: 'CBEBirr Digital Wallet', shortCode: 'CBEBIRR', category: 'Wallet', ussd: '*847#', app: 'CBEBirr Plus' },
  { name: 'Amole Digital Wallet (Dashen)', shortCode: 'AMOLE', category: 'Wallet', ussd: '*996#', app: 'Amole / Dashen SuperApp' },
  { name: 'Coopay-Ebirr Wallet', shortCode: 'COOPAY', category: 'Wallet', ussd: '*847#', app: 'Coopay-Ebirr' },
  { name: 'E-Birr Mobile Wallet', shortCode: 'EBIRR', category: 'Wallet', ussd: '*847#', app: 'E-Birr App' },
  { name: 'HelloCash Mobile Money', shortCode: 'HELLOCASH', category: 'Wallet', ussd: '*803#', app: 'HelloCash' },
  { name: 'Kacha Digital Financial Services (Wallet)', shortCode: 'KACHA', category: 'Wallet', ussd: '*677#', app: 'Kacha Wallet' },
  { name: 'Yaya Wallet', shortCode: 'YAYA', category: 'Wallet', ussd: '*949#', app: 'Yaya Wallet' },
  { name: 'AwashBirr Wallet', shortCode: 'AWASHBIRR', category: 'Wallet', ussd: '*901#', app: 'AwashBirr Pro' },
  { name: 'HalalPay (Hijra Wallet)', shortCode: 'HALALPAY', category: 'Wallet', ussd: '*922#', app: 'HalalPay' },
  { name: 'Apollo Digital (Bank of Abyssinia)', shortCode: 'APOLLO', category: 'Wallet', ussd: '*815#', app: 'Apollo by BoA' },

  // Payment Gateways & Microfinance Institutions (MFIs)
  { name: 'Chapa Financial Technologies', shortCode: 'CHAPA', category: 'MFI / Gateway', app: 'Chapa Merchant' },
  { name: 'ArifPay Payment Gateway', shortCode: 'ARIFPAY', category: 'MFI / Gateway', app: 'ArifPay' },
  { name: 'SantimPay Digital Payment', shortCode: 'SANTIMPAY', category: 'MFI / Gateway', app: 'SantimPay' },
  { name: 'LakiPay Ethiopia', shortCode: 'LAKIPAY', category: 'MFI / Gateway', app: 'LakiPay' },
  { name: 'VisionFund Microfinance (MFI)', shortCode: 'VISIONFUND', category: 'MFI / Gateway' },
  { name: 'Dedebit Credit & Saving Institution (DECSI)', shortCode: 'DECSI', category: 'MFI / Gateway' },
  { name: 'Rays Microfinance Institution', shortCode: 'RAYS', category: 'MFI / Gateway' },
  { name: 'Peace Microfinance Institution', shortCode: 'PEACE', category: 'MFI / Gateway' },
  { name: 'Wasasa Microfinance Institution', shortCode: 'WASASA', category: 'MFI / Gateway' },
  { name: 'Eshet Microfinance Institution', shortCode: 'ESHET', category: 'MFI / Gateway' },
];

const ETHIOPIAN_USSD_PRESETS = [
  { label: 'CBE (*889#)', code: '*889#', app: 'CBE Birr / Mobile' },
  { label: 'Abyssinia (*815#)', code: '*815#', app: 'BoA Apollo / Mobile' },
  { label: 'Telebirr (*127#)', code: '*127#', app: 'Telebirr SuperApp' },
  { label: 'M-Pesa (*733#)', code: '*733#', app: 'M-Pesa Safaricom' },
  { label: 'Awash (*901#)', code: '*901#', app: 'AwashBirr Pro' },
  { label: 'Dashen (*805#)', code: '*805#', app: 'Amole / Dashen SuperApp' },
  { label: 'Coopbank (*847#)', code: '*847#', app: 'Coopay-Ebirr' },
  { label: 'Nib (*855#)', code: '*855#', app: 'NIBTerara' },
  { label: 'Hibret (*811#)', code: '*811#', app: 'Hibir Mobile' },
  { label: 'Wegagen (*866#)', code: '*866#', app: 'Wegagen Mobile' },
  { label: 'Oromia (*877#)', code: '*877#', app: 'Oromia Mobile' },
  { label: 'Zemen (*844#)', code: '*844#', app: 'Zemen OmniChannel' },
  { label: 'Amhara (*645#)', code: '*645#', app: 'ABa Mobile' },
  { label: 'Abay (*812#)', code: '*812#', app: 'Abay Mobile' },
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
  // Store balance as a clean string in the input so typing '58' never writes '058'
  const [balanceInput, setBalanceInput] = useState<string>('');

  // Custom Banks / Wallets saved by the user
  const [customInstitutions, setCustomInstitutions] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem(CUSTOM_BANKS_STORAGE_KEY);
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });
  const [showOrgSuggestions, setShowOrgSuggestions] = useState(false);
  const [customSavedNotice, setCustomSavedNotice] = useState(false);

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
      setBalanceInput(
        initialAccount.currentBalance && initialAccount.currentBalance !== 0
          ? String(initialAccount.currentBalance)
          : ''
      );

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
    setBalanceInput('');
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
    setShowOrgSuggestions(false);
    setErrors({});
  };

  // Combined suggestions (Custom saved banks + Top 55 Ethiopian Banks, Wallets & MFIs)
  const filteredInstitutionSuggestions = useMemo(() => {
    const query = orgName.trim().toLowerCase();
    const customPresets: InstitutionPreset[] = customInstitutions.map((c) => ({
      name: c,
      shortCode: 'CUSTOM',
      category: 'Bank',
    }));
    const all = [...customPresets, ...ETHIOPIAN_FINANCIAL_INSTITUTIONS];

    if (!query) {
      return all.slice(0, 12);
    }
    return all
      .filter(
        (item) =>
          item.name.toLowerCase().includes(query) ||
          item.shortCode.toLowerCase().includes(query) ||
          item.category.toLowerCase().includes(query) ||
          (item.ussd && item.ussd.includes(query))
      )
      .slice(0, 12);
  }, [orgName, customInstitutions]);

  const isExactInstitutionMatch = useMemo(() => {
    const clean = orgName.trim().toLowerCase();
    if (!clean) return true;
    const inBuiltIn = ETHIOPIAN_FINANCIAL_INSTITUTIONS.some(
      (i) => i.name.toLowerCase() === clean || i.shortCode.toLowerCase() === clean
    );
    const inCustom = customInstitutions.some((c) => c.toLowerCase() === clean);
    return inBuiltIn || inCustom;
  }, [orgName, customInstitutions]);

  const handleSaveCustomInstitution = (customName: string) => {
    const trimmed = customName.trim();
    if (!trimmed) return;
    if (customInstitutions.some((c) => c.toLowerCase() === trimmed.toLowerCase())) return;
    const updated = [trimmed, ...customInstitutions];
    setCustomInstitutions(updated);
    localStorage.setItem(CUSTOM_BANKS_STORAGE_KEY, JSON.stringify(updated));
    setCustomSavedNotice(true);
    setTimeout(() => setCustomSavedNotice(false), 2500);
  };

  const handleRemoveCustomInstitution = (customName: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const updated = customInstitutions.filter((c) => c !== customName);
    setCustomInstitutions(updated);
    localStorage.setItem(CUSTOM_BANKS_STORAGE_KEY, JSON.stringify(updated));
  };

  const handleSelectInstitutionPreset = (preset: InstitutionPreset) => {
    setOrgName(preset.name);
    if (preset.ussd && !ussdCode) {
      setUssdCode(preset.ussd);
    }
    if (preset.app && !appIdentifier) {
      setAppIdentifier(preset.app);
    }
    setShowOrgSuggestions(false);
  };

  // Auto-slash Expiry (MM/YY) handler: automatically inserts '/' after typing 2 month digits
  const handleExpiryChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const rawVal = e.target.value;
    const isDeleting = rawVal.length < expiry.length;
    const digits = rawVal.replace(/\D/g, '').slice(0, 4);

    if (isDeleting) {
      // If user hit backspace right after the auto-inserted '/', remove the 2nd digit too
      if (expiry.endsWith('/') && !rawVal.endsWith('/')) {
        setExpiry(digits.slice(0, 1));
      } else if (digits.length > 2) {
        setExpiry(`${digits.slice(0, 2)}/${digits.slice(2)}`);
      } else {
        setExpiry(digits);
      }
      return;
    }

    if (digits.length === 0) {
      setExpiry('');
    } else if (digits.length === 1) {
      // If user types 2-9 as first month digit (e.g. '4' for April), keep it as '4' until 2nd digit or let them type 2 digits
      setExpiry(digits);
    } else if (digits.length === 2) {
      let month = parseInt(digits, 10);
      if (month > 12) month = 12;
      if (month === 0) month = 1;
      const paddedMonth = String(month).padStart(2, '0');
      setExpiry(`${paddedMonth}/`);
    } else {
      let month = parseInt(digits.slice(0, 2), 10);
      if (month > 12) month = 12;
      if (month === 0) month = 1;
      const paddedMonth = String(month).padStart(2, '0');
      setExpiry(`${paddedMonth}/${digits.slice(2, 4)}`);
    }
  };

  // Clean Balance Input handler: strips leading zeros so typing '58' never shows '058'
  const handleBalanceInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let val = e.target.value;
    if (val === '') {
      setBalanceInput('');
      return;
    }
    // Allow digits and at most one decimal point
    val = val.replace(/[^0-9.]/g, '');
    const parts = val.split('.');
    if (parts.length > 2) {
      val = `${parts[0]}.${parts.slice(1).join('')}`;
    }
    // Strip leading zeros before another digit (e.g. "058" -> "58", while preserving "0.5")
    val = val.replace(/^0+(?=\d)/, '');
    setBalanceInput(val);
  };

  const handleSmartParse = () => {
    if (!rawPasteText.trim()) return;
    const parsed = parseRawAccountSnippet(rawPasteText);
    if (parsed.name) setName(parsed.name);
    if (parsed.accountNumber) setAccountNumber(parsed.accountNumber);
    if (parsed.phoneNumber) setPhoneNumber(parsed.phoneNumber);
    if (parsed.orgName) setOrgName(parsed.orgName);
    if (parsed.currency) setCurrency(parsed.currency);
    if (parsed.currentBalance !== undefined) {
      setBalanceInput(parsed.currentBalance > 0 ? String(parsed.currentBalance) : '');
    }

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

      const res = await fetch(resolveApiUrl('/api/ai/scan-document'), {
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
        setBalanceInput(String(data.currentBalance));
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
    const parsedBalance = parseFloat(balanceInput);
    const numericBalance = Number.isFinite(parsedBalance) ? parsedBalance : 0;

    // Normalize expiry if it ends with trailing slash (e.g. '12/' -> '')
    const normalizedExpiry = expiry.endsWith('/') ? expiry.slice(0, -1) : expiry.trim();

    // Auto-save custom bank/organization name if not in built-in list
    if (orgName.trim() && !isExactInstitutionMatch) {
      handleSaveCustomInstitution(orgName.trim());
    }

    const candidateAccount: Partial<AccountRecord> = {
      name: name.trim(),
      accountNumber: accountNumber.trim(),
      phoneNumber: phoneNumber.trim(),
      orgName: orgName.trim(),
      branchName: branchName.trim(),
      currency,
      language,
      memo: memo.trim(),
      currentBalance: numericBalance,
      atm: {
        hasAtm,
        atmNumber: hasAtm ? atmNumber.trim() : undefined,
        cvv: hasAtm ? cvv.trim() : undefined,
        atmPin: hasAtm ? atmPin.trim() : undefined,
        expiry: hasAtm ? normalizedExpiry : undefined,
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
              {/* Security Warning Banner for Bank Cards */}
              <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-[11px] text-amber-200 space-y-1">
                <p className="font-bold text-amber-300">
                  Security Advisory: Store Only the Last 4 Digits
                </p>
                <p className="text-slate-300 leading-relaxed">
                  Bank card numbers should not be stored in full in a home-built vault. Store only the <strong>last 4 digits</strong> and the card name, and keep full details in a dedicated password manager.
                </p>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-xs font-medium text-slate-300">
                    Card Last 4 Digits (or Card #) <span className="text-emerald-400">*</span>
                  </label>
                  {atmNumber.replace(/\D/g, '').length > 4 && (
                    <button
                      type="button"
                      onClick={() => setAtmNumber(atmNumber.replace(/\D/g, '').slice(-4))}
                      className="text-[11px] font-mono text-emerald-400 hover:underline"
                    >
                      Keep Last 4 Digits Only ({atmNumber.replace(/\D/g, '').slice(-4)})
                    </button>
                  )}
                </div>
                <input
                  type="text"
                  value={atmNumber}
                  onChange={(e) => {
                    setAtmNumber(e.target.value);
                    if (errors.atmNumber) setErrors({ ...errors, atmNumber: '' });
                  }}
                  placeholder="e.g. 4821 (Last 4 digits recommended)"
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
                    inputMode="numeric"
                    value={expiry}
                    onChange={handleExpiryChange}
                    placeholder="MM/YY"
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
            Institution & Balance Metadata (50+ Ethiopian Banks, Wallets & Custom)
          </h4>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {/* Searchable Bank / Wallet / Organization Field with Autocomplete & Custom Save */}
            <div className="relative">
              <div className="flex items-center justify-between mb-1">
                <label className="block text-xs font-medium text-slate-300">
                  {t.bankOrgName}
                </label>
                {orgName.trim() && !isExactInstitutionMatch && (
                  <button
                    type="button"
                    onClick={() => handleSaveCustomInstitution(orgName)}
                    className="text-[11px] font-mono text-emerald-400 hover:text-emerald-300 flex items-center gap-1"
                  >
                    <Plus className="w-3 h-3" />
                    <span>Save "{orgName.trim().slice(0, 18)}" to Custom List</span>
                  </button>
                )}
                {customSavedNotice && (
                  <span className="text-[10px] font-mono text-emerald-400 flex items-center gap-1">
                    <Check className="w-3 h-3" /> Saved!
                  </span>
                )}
              </div>

              <input
                type="text"
                value={orgName}
                onFocus={() => setShowOrgSuggestions(true)}
                onBlur={() => {
                  // Delay hiding so clicking a suggestion registers first
                  setTimeout(() => setShowOrgSuggestions(false), 180);
                }}
                onChange={(e) => {
                  setOrgName(e.target.value);
                  setShowOrgSuggestions(true);
                }}
                placeholder="Type bank/wallet (e.g. CBE, Abyssinia, Telebirr, Dashen, M-Pesa...)"
                className="w-full h-11 px-3.5 rounded-xl bg-slate-900 border border-slate-800 text-slate-100 placeholder-slate-500 text-sm focus:outline-none focus:border-emerald-500"
              />

              {/* Live Autocomplete Dropdown while typing */}
              {showOrgSuggestions && filteredInstitutionSuggestions.length > 0 && (
                <div className="absolute z-40 left-0 right-0 mt-1 max-h-56 overflow-y-auto rounded-2xl bg-slate-950 border border-slate-700 shadow-2xl divide-y divide-slate-800/70">
                  {filteredInstitutionSuggestions.map((item) => (
                    <button
                      key={`${item.shortCode}-${item.name}`}
                      type="button"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        handleSelectInstitutionPreset(item);
                      }}
                      className="w-full px-3.5 py-2.5 text-left hover:bg-slate-900 flex items-center justify-between gap-2 transition-colors"
                    >
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-slate-100 truncate">
                          {item.name}
                        </p>
                        {item.ussd && (
                          <p className="text-[10px] font-mono text-slate-400">
                            USSD: {item.ussd} {item.app ? `· ${item.app}` : ''}
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <span
                          className={`px-2 py-0.5 rounded-md text-[10px] font-mono ${
                            item.shortCode === 'CUSTOM'
                              ? 'bg-purple-500/15 text-purple-300 border border-purple-500/30'
                              : item.category === 'Wallet'
                              ? 'bg-cyan-500/15 text-cyan-300 border border-cyan-500/30'
                              : 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                          }`}
                        >
                          {item.shortCode === 'CUSTOM' ? 'Custom' : item.category}
                        </span>
                        {item.shortCode === 'CUSTOM' && (
                          <span
                            role="button"
                            tabIndex={0}
                            onMouseDown={(e) => handleRemoveCustomInstitution(item.name, e)}
                            className="p-1 rounded hover:bg-rose-500/20 text-slate-400 hover:text-rose-400"
                            title="Remove custom institution"
                          >
                            <X className="w-3 h-3" />
                          </span>
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              )}
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

          {/* Quick Select Ethiopian Banks, Wallets & Custom Chips */}
          <div className="p-3 rounded-2xl bg-slate-950/70 border border-slate-800/80 space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-[10px] text-slate-400 font-mono flex items-center gap-1.5">
                <Building2 className="w-3 h-3 text-emerald-400" />
                Quick Select Institution (or type above to search all 50+ Ethiopian Banks & Wallets):
              </p>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {/* Custom User-Added Institutions first */}
              {customInstitutions.map((customName) => (
                <button
                  key={`custom-${customName}`}
                  type="button"
                  onClick={() => setOrgName(customName)}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-mono flex items-center gap-1.5 transition-colors ${
                    orgName === customName
                      ? 'bg-emerald-600 text-white'
                      : 'bg-purple-950/40 border border-purple-500/30 text-purple-200 hover:border-purple-400'
                  }`}
                >
                  <span>{customName}</span>
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={(e) => handleRemoveCustomInstitution(customName, e)}
                    className="hover:text-rose-300"
                    title="Delete custom institution"
                  >
                    <X className="w-3 h-3" />
                  </span>
                </button>
              ))}

              {/* Top Quick Presets */}
              {ETHIOPIAN_FINANCIAL_INSTITUTIONS.slice(0, 14).map((inst) => (
                <button
                  key={inst.shortCode}
                  type="button"
                  onClick={() => handleSelectInstitutionPreset(inst)}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-mono transition-colors ${
                    orgName === inst.name
                      ? 'bg-emerald-600 text-white'
                      : 'bg-slate-900 border border-slate-800 text-slate-300 hover:border-emerald-500/40'
                  }`}
                >
                  {inst.shortCode === 'TELEBIRR' || inst.shortCode === 'MPESA' || inst.shortCode === 'CBEBIRR'
                    ? `${inst.shortCode} (Wallet)`
                    : `${inst.shortCode} · ${inst.name.split(' (')[0]}`}
                </button>
              ))}
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
                type="text"
                inputMode="decimal"
                value={balanceInput}
                onChange={handleBalanceInputChange}
                placeholder="0.00"
                className="w-full h-11 px-3 rounded-xl bg-slate-900 border border-slate-800 text-slate-100 placeholder-slate-500 font-mono text-sm focus:outline-none focus:border-emerald-500"
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

import React, { useState, useEffect } from 'react';
import {
  Shield,
  Lock,
  KeyRound,
  Fingerprint,
  Eye,
  EyeOff,
  Delete,
  Grid,
  Type as TypeIcon,
  Database,
  CheckCircle2,
} from 'lucide-react';
import { SupportedLanguage } from '../types/account';
import { translations } from '../utils/i18n';
import {
  hasQuickPinConfigured,
  unlockWithQuickPin,
  hasBiometricPasskeyEnrolled,
  authenticateBiometricPasskey,
  registerBiometricPasskey,
  setupQuickPin,
} from '../utils/crypto';

interface MasterLockModalProps {
  isLocked: boolean;
  onUnlock: (passphrase: string) => Promise<boolean>;
  onSetupMaster: (
    passphrase: string,
    options?: { quickPin?: string; loadDemo?: boolean; enableBiometrics?: boolean }
  ) => Promise<void>;
  hasExistingMaster: boolean;
  currentLanguage: SupportedLanguage;
}

export const MasterLockModal: React.FC<MasterLockModalProps> = ({
  isLocked,
  onUnlock,
  onSetupMaster,
  hasExistingMaster,
  currentLanguage,
}) => {
  const t = translations[currentLanguage];

  const [unlockMode, setUnlockMode] = useState<'passphrase' | 'pin'>('passphrase');
  const [passphrase, setPassphrase] = useState('');
  const [confirmPassphrase, setConfirmPassphrase] = useState('');
  const [quickPinInput, setQuickPinInput] = useState('');
  const [onboardingQuickPin, setOnboardingQuickPin] = useState('');
  const [loadDemoOnInit, setLoadDemoOnInit] = useState(false);
  const [enrollBiometricsOnInit, setEnrollBiometricsOnInit] = useState(true);

  const [showPassphrase, setShowPassphrase] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [hasPinConfigured, setHasPinConfigured] = useState(false);
  const [hasBioEnrolled, setHasBioEnrolled] = useState(false);
  const [failedAttempts, setFailedAttempts] = useState(0);
  const [lockoutUntil, setLockoutUntil] = useState<number | null>(null);
  const [lockoutRemaining, setLockoutRemaining] = useState(0);

  useEffect(() => {
    const pinConfigured = hasQuickPinConfigured();
    const bioConfigured = hasBiometricPasskeyEnrolled();
    setHasPinConfigured(pinConfigured);
    setHasBioEnrolled(bioConfigured);
    if (hasExistingMaster && pinConfigured) {
      setUnlockMode('pin');
    } else {
      setUnlockMode('passphrase');
    }
    setQuickPinInput('');
    setErrorMessage(null);
  }, [isLocked, hasExistingMaster]);

  // Countdown timer for rate-limit lockout
  useEffect(() => {
    if (!lockoutUntil) {
      setLockoutRemaining(0);
      return;
    }
    const tick = () => {
      const rem = Math.ceil((lockoutUntil - Date.now()) / 1000);
      if (rem <= 0) {
        setLockoutUntil(null);
        setLockoutRemaining(0);
        setFailedAttempts(0);
        setErrorMessage(null);
      } else {
        setLockoutRemaining(rem);
      }
    };
    tick();
    const interval = setInterval(tick, 500);
    return () => clearInterval(interval);
  }, [lockoutUntil]);

  const recordFailedAttempt = (customMsg: string) => {
    const nextCount = failedAttempts + 1;
    setFailedAttempts(nextCount);
    if (nextCount >= 5) {
      const until = Date.now() + 30000;
      setLockoutUntil(until);
      setErrorMessage('Too many failed unlock attempts. Locked for 30 seconds.');
    } else {
      setErrorMessage(`${customMsg} (${5 - nextCount} attempts remaining before cooldown)`);
    }
  };

  // Auto-submit when 6-digit PIN is entered on keypad
  useEffect(() => {
    if (unlockMode === 'pin' && hasExistingMaster && quickPinInput.length === 6 && !lockoutUntil) {
      handleQuickPinUnlock(quickPinInput);
    }
  }, [quickPinInput, unlockMode, hasExistingMaster, lockoutUntil]);

  if (!isLocked && hasExistingMaster) return null;

  const handleQuickPinUnlock = async (pinCode: string) => {
    if (lockoutUntil && Date.now() < lockoutUntil) return;
    setIsVerifying(true);
    setErrorMessage(null);
    try {
      const unwrappedPassphrase = await unlockWithQuickPin(pinCode);
      if (!unwrappedPassphrase) {
        recordFailedAttempt('Invalid 6-digit PIN.');
        setQuickPinInput('');
        if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
          navigator.vibrate([60, 40, 60]);
        }
        return;
      }
      const ok = await onUnlock(unwrappedPassphrase);
      if (!ok) {
        recordFailedAttempt('PIN decryption mismatch. Use Master Passphrase.');
        setUnlockMode('passphrase');
      } else {
        setFailedAttempts(0);
        setLockoutUntil(null);
        setQuickPinInput('');
      }
    } catch {
      recordFailedAttempt('Failed to verify Quick PIN.');
      setQuickPinInput('');
    } finally {
      setIsVerifying(false);
    }
  };

  const handleKeypadDigit = (digit: string) => {
    if (lockoutUntil && Date.now() < lockoutUntil) return;
    if (quickPinInput.length < 6 && !isVerifying) {
      if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
        navigator.vibrate(15);
      }
      setErrorMessage(null);
      setQuickPinInput((prev) => prev + digit);
    }
  };

  const handleKeypadBackspace = () => {
    setQuickPinInput((prev) => prev.slice(0, -1));
    setErrorMessage(null);
  };

  const handleUnlockSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!passphrase) return;
    if (lockoutUntil && Date.now() < lockoutUntil) return;
    setIsVerifying(true);
    setErrorMessage(null);

    try {
      if (!hasExistingMaster) {
        if (passphrase.length < 6) {
          setErrorMessage('Master Passphrase must be at least 6 characters.');
          setIsVerifying(false);
          return;
        }
        if (passphrase !== confirmPassphrase) {
          setErrorMessage('Passphrases do not match.');
          setIsVerifying(false);
          return;
        }
        if (onboardingQuickPin && !/^\d{6}$/.test(onboardingQuickPin)) {
          setErrorMessage('Optional Quick PIN must be exactly 6 numeric digits.');
          setIsVerifying(false);
          return;
        }

        await onSetupMaster(passphrase, {
          quickPin: onboardingQuickPin || undefined,
          loadDemo: loadDemoOnInit,
          enableBiometrics: enrollBiometricsOnInit,
        });
        setPassphrase('');
        setConfirmPassphrase('');
        setOnboardingQuickPin('');
      } else {
        const success = await onUnlock(passphrase);
        if (!success) {
          recordFailedAttempt('Invalid Master Passphrase. Decryption failed.');
        } else {
          setFailedAttempts(0);
          setLockoutUntil(null);
          setPassphrase('');
        }
      }
    } catch {
      recordFailedAttempt('Decryption verification error.');
    } finally {
      setIsVerifying(false);
    }
  };

  const handleBiometricUnlock = async () => {
    setIsVerifying(true);
    setErrorMessage(null);
    try {
      if (!hasBioEnrolled) {
        if (passphrase.length >= 6) {
          const ok = await onUnlock(passphrase);
          if (ok) {
            await registerBiometricPasskey(passphrase);
            setHasBioEnrolled(true);
            setPassphrase('');
            return;
          }
        }
        setErrorMessage(
          'Enter your Master Passphrase once and click Unlock to pair Hardware Biometrics.'
        );
        setUnlockMode('passphrase');
        return;
      }

      const unwrappedPassphrase = await authenticateBiometricPasskey();
      if (!unwrappedPassphrase) {
        setErrorMessage('Biometric verification failed or was cancelled.');
        return;
      }
      const ok = await onUnlock(unwrappedPassphrase);
      if (!ok) {
        setErrorMessage('Biometric key expired. Please unlock with Master Passphrase.');
        setUnlockMode('passphrase');
      }
    } catch {
      setErrorMessage('Biometric verification cancelled.');
    } finally {
      setIsVerifying(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#070b14]/95 backdrop-blur-xl animate-fade-in text-slate-100 overflow-y-auto">
      <div className="w-full max-w-md rounded-3xl bg-[#0d1424] border border-emerald-500/30 p-6 shadow-2xl shadow-emerald-950/40 relative overflow-hidden my-auto">
        {/* Top ambient glow */}
        <div className="absolute -top-16 -right-16 w-40 h-40 rounded-full bg-emerald-500/15 blur-3xl pointer-events-none" />

        {/* Shield Icon & Header */}
        <div className="text-center space-y-2 mb-5">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-emerald-500/20 to-teal-900/30 border border-emerald-500/40 mx-auto flex items-center justify-center shadow-inner">
            <Lock className="w-7 h-7 text-emerald-400" />
          </div>
          <div>
            <h2 className="text-xl font-extrabold text-slate-100 tracking-tight font-sans">
              {t.appName}
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              {hasExistingMaster
                ? 'AES-256-GCM Encrypted Vault Locked'
                : 'First-Launch Setup • Create Your Master Vault Key'}
            </p>
          </div>
        </div>

        {/* Mode Switcher for Returning Users (6-Digit PIN Keypad vs Master Passphrase) */}
        {hasExistingMaster && hasPinConfigured && (
          <div className="grid grid-cols-2 gap-1 p-1 bg-slate-950 border border-slate-800 rounded-xl mb-4">
            <button
              type="button"
              onClick={() => {
                setUnlockMode('pin');
                setErrorMessage(null);
              }}
              className={`py-2 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors ${
                unlockMode === 'pin'
                  ? 'bg-emerald-600 text-white shadow'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Grid className="w-3.5 h-3.5" />
              <span>6-Digit PIN</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setUnlockMode('passphrase');
                setErrorMessage(null);
              }}
              className={`py-2 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors ${
                unlockMode === 'passphrase'
                  ? 'bg-emerald-600 text-white shadow'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <TypeIcon className="w-3.5 h-3.5" />
              <span>Passphrase</span>
            </button>
          </div>
        )}

        {/* ================= A. 6-DIGIT NUMERIC KEYPAD UNLOCK ================= */}
        {hasExistingMaster && unlockMode === 'pin' ? (
          <div className="space-y-5">
            <div className="text-center space-y-2">
              <p className="text-xs text-slate-400 font-mono">Enter 6-Digit Vault Quick PIN</p>
              <div className="flex items-center justify-center gap-3 py-2">
                {[0, 1, 2, 3, 4, 5].map((idx) => {
                  const filled = idx < quickPinInput.length;
                  return (
                    <div
                      key={idx}
                      className={`w-3.5 h-3.5 rounded-full transition-all duration-150 ${
                        filled
                          ? 'bg-emerald-400 scale-110 shadow-sm shadow-emerald-400/50'
                          : 'bg-slate-800 border border-slate-700'
                      }`}
                    />
                  );
                })}
              </div>
            </div>

            {errorMessage && (
              <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl p-2 text-center font-mono">
                {errorMessage}
                {lockoutRemaining > 0 && ` (Wait ${lockoutRemaining}s)`}
              </p>
            )}

            {/* 3x4 Mobile Numeric Keypad */}
            <div className="grid grid-cols-3 gap-2.5 max-w-[260px] mx-auto">
              {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((digit) => (
                <button
                  key={digit}
                  type="button"
                  onClick={() => handleKeypadDigit(digit)}
                  disabled={isVerifying || lockoutRemaining > 0}
                  className="h-13 rounded-2xl bg-slate-900/90 hover:bg-slate-800 active:scale-95 border border-slate-800 text-lg font-mono font-bold text-slate-100 transition-all flex items-center justify-center disabled:opacity-40"
                >
                  {digit}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setQuickPinInput('')}
                className="h-13 rounded-2xl bg-slate-950 hover:bg-slate-900 border border-slate-800/80 text-[11px] font-mono text-slate-400 hover:text-slate-200 flex items-center justify-center"
              >
                CLR
              </button>
              <button
                type="button"
                onClick={() => handleKeypadDigit('0')}
                disabled={isVerifying || lockoutRemaining > 0}
                className="h-13 rounded-2xl bg-slate-900/90 hover:bg-slate-800 active:scale-95 border border-slate-800 text-lg font-mono font-bold text-slate-100 transition-all flex items-center justify-center disabled:opacity-40"
              >
                0
              </button>
              <button
                type="button"
                onClick={handleKeypadBackspace}
                className="h-13 rounded-2xl bg-slate-950 hover:bg-slate-900 border border-slate-800/80 text-slate-300 flex items-center justify-center"
                aria-label="Backspace"
              >
                <Delete className="w-5 h-5" />
              </button>
            </div>
          </div>
        ) : (
          /* ================= B. MASTER PASSPHRASE & ONBOARDING FORM ================= */
          <form onSubmit={handleUnlockSubmit} className="space-y-3.5">
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1 font-mono">
                {hasExistingMaster ? 'Master Passphrase' : 'Create Master Passphrase *'}
              </label>
              <div className="relative">
                <input
                  type={showPassphrase ? 'text' : 'password'}
                  required
                  value={passphrase}
                  onChange={(e) => {
                    setPassphrase(e.target.value);
                    if (errorMessage && !lockoutRemaining) setErrorMessage(null);
                  }}
                  placeholder={
                    hasExistingMaster
                      ? 'Enter your master passphrase...'
                      : 'Strong passphrase (min 6 chars)...'
                  }
                  className="w-full h-11 px-3.5 pr-10 rounded-xl bg-slate-950 border border-slate-700/80 text-slate-100 placeholder-slate-500 text-sm focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
                />
                <button
                  type="button"
                  onClick={() => setShowPassphrase(!showPassphrase)}
                  aria-label="Toggle password visibility"
                  className="absolute right-3 top-3 text-slate-400 hover:text-white"
                >
                  {showPassphrase ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {!hasExistingMaster && (
              <>
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1 font-mono">
                    Confirm Master Passphrase *
                  </label>
                  <input
                    type={showPassphrase ? 'text' : 'password'}
                    required
                    value={confirmPassphrase}
                    onChange={(e) => setConfirmPassphrase(e.target.value)}
                    placeholder="Re-type master passphrase..."
                    className="w-full h-11 px-3.5 rounded-xl bg-slate-950 border border-slate-700/80 text-slate-100 placeholder-slate-500 text-sm focus:outline-none focus:border-emerald-500"
                  />
                </div>

                {/* Optional 6-Digit Quick PIN during Onboarding */}
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1 font-mono">
                    6-Digit Mobile Quick PIN (Optional)
                  </label>
                  <input
                    type="password"
                    inputMode="numeric"
                    maxLength={6}
                    value={onboardingQuickPin}
                    onChange={(e) => setOnboardingQuickPin(e.target.value.replace(/\D/g, ''))}
                    placeholder="e.g. 849201 (for fast keypad unlock)"
                    className="w-full h-10 px-3.5 rounded-xl bg-slate-950 border border-slate-800 text-slate-100 placeholder-slate-500 text-xs font-mono tracking-widest focus:outline-none focus:border-emerald-500"
                  />
                </div>

                {/* Onboarding Options: Biometric Pairing & Demo Sandbox */}
                <div className="p-3 rounded-2xl bg-slate-950/90 border border-slate-800/90 space-y-2.5 text-xs">
                  <label className="flex items-center justify-between cursor-pointer">
                    <span className="flex items-center gap-2 text-slate-300">
                      <Fingerprint className="w-4 h-4 text-emerald-400 shrink-0" />
                      <span>Pair Biometric / WebAuthn Hardware Key</span>
                    </span>
                    <input
                      type="checkbox"
                      checked={enrollBiometricsOnInit}
                      onChange={(e) => setEnrollBiometricsOnInit(e.target.checked)}
                      className="rounded border-slate-700 text-emerald-500 focus:ring-emerald-500"
                    />
                  </label>

                  <div className="border-t border-slate-800/80 pt-2.5">
                    <label className="flex items-center justify-between cursor-pointer">
                      <span className="flex items-center gap-2 text-slate-300">
                        <Database className="w-4 h-4 text-cyan-400 shrink-0" />
                        <span>Load Demo Accounts &amp; SaaS Secrets</span>
                      </span>
                      <input
                        type="checkbox"
                        checked={loadDemoOnInit}
                        onChange={(e) => setLoadDemoOnInit(e.target.checked)}
                        className="rounded border-slate-700 text-emerald-500 focus:ring-emerald-500"
                      />
                    </label>
                    <p className="text-[10px] text-slate-500 mt-1">
                      {loadDemoOnInit
                        ? 'Will populate sample accounts & SaaS API secrets encrypted with your new Master Passphrase.'
                        : 'Starts with a clean, 100% empty zero-knowledge vault. You can also load demo data later.'}
                    </p>
                  </div>
                </div>
              </>
            )}

            {errorMessage && (
              <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl p-2.5 text-center font-mono">
                {errorMessage}
                {lockoutRemaining > 0 && ` (Wait ${lockoutRemaining}s)`}
              </p>
            )}

            <button
              type="submit"
              disabled={isVerifying || lockoutRemaining > 0}
              className="w-full h-12 rounded-xl bg-emerald-600 hover:bg-emerald-500 active:scale-[0.98] text-white text-sm font-semibold flex items-center justify-center gap-2 shadow-lg shadow-emerald-950 transition-all disabled:opacity-50"
            >
              <KeyRound className="w-4 h-4" />
              <span>
                {lockoutRemaining > 0
                  ? `Rate Limited • Retry in ${lockoutRemaining}s`
                  : isVerifying
                  ? 'Deriving PBKDF2 (600k) Key...'
                  : hasExistingMaster
                  ? t.unlockVault
                  : 'Create Encrypted Vault'}
              </span>
            </button>
          </form>
        )}

        {/* Biometric Unlock Option for Returning Users (Large Touch Target) */}
        {hasExistingMaster && (
          <div className="mt-5 pt-4 border-t border-slate-800 text-center">
            <button
              type="button"
              onClick={handleBiometricUnlock}
              disabled={isVerifying}
              className="w-full py-4 px-5 rounded-2xl bg-emerald-500/10 hover:bg-emerald-500/20 active:scale-[0.98] border-2 border-emerald-500/40 hover:border-emerald-400 text-slate-100 flex items-center justify-center gap-4 shadow-lg shadow-emerald-950/50 transition-all group disabled:opacity-50"
            >
              <div className="w-14 h-14 rounded-2xl bg-emerald-500/20 border border-emerald-400/40 flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform shadow-inner">
                <Fingerprint className="w-8 h-8 text-emerald-400" />
              </div>
              <div className="text-left">
                <span className="block text-sm sm:text-base font-bold text-slate-100 group-hover:text-emerald-300 transition-colors">
                  {hasBioEnrolled ? t.biometricUnlock : 'Pair & Unlock with Biometrics'}
                </span>
                <span className="block text-[11px] font-mono text-emerald-400/90 mt-0.5">
                  {hasBioEnrolled
                    ? 'Tap sensor to unlock with Fingerprint / Face ID'
                    : 'Tap to pair hardware fingerprint passkey'}
                </span>
              </div>
            </button>
          </div>
        )}

        {/* Security Architecture Footer */}
        <div className="mt-4 pt-3 border-t border-slate-800/80 flex items-center justify-center gap-1.5 text-[10px] text-slate-500">
          <Shield className="w-3 h-3 text-emerald-400" />
          <span>Full Vault AES-256-GCM at Rest • Zero Plaintext Storage</span>
        </div>
      </div>
    </div>
  );
};

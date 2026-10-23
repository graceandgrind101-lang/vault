import React, { useState } from 'react';
import { motion } from 'motion/react';
import { Eye, EyeOff, Copy, Check, RotateCw, Wifi, ShieldCheck, CreditCard } from 'lucide-react';
import { AccountRecord } from '../types/account';
import { maskCardNumber, formatCardNumber, detectCardNetwork } from '../utils/validator';

interface VirtualCardProps {
  account: AccountRecord;
  isUnlocked: boolean;
  onCopy?: (text: string, label: string) => void;
}

export const VirtualCard: React.FC<VirtualCardProps> = ({ account, isUnlocked, onCopy }) => {
  const [isFlipped, setIsFlipped] = useState(false);
  const [showSensitiveDetails, setShowSensitiveDetails] = useState(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  const atm = account.atm;
  const hasAtm = atm?.hasAtm;
  const network = atm?.cardNetwork || (atm?.atmNumber ? detectCardNetwork(atm.atmNumber) : 'generic');

  const handleCopy = (e: React.MouseEvent, text?: string, fieldName: string = 'Card Number') => {
    e.stopPropagation();
    if (!text) return;
    navigator.clipboard?.writeText(text);
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      navigator.vibrate(35);
    }
    setCopiedField(fieldName);
    if (onCopy) onCopy(text, fieldName);
    setTimeout(() => setCopiedField(null), 2000);
  };

  const toggleFlip = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsFlipped(!isFlipped);
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      navigator.vibrate(25);
    }
  };

  const toggleReveal = (e: React.MouseEvent) => {
    e.stopPropagation();
    setShowSensitiveDetails(!showSensitiveDetails);
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      navigator.vibrate(40);
    }
    // Auto-mask after 12 seconds for zero-knowledge safety
    if (!showSensitiveDetails) {
      setTimeout(() => {
        setShowSensitiveDetails(false);
      }, 12000);
    }
  };

  // Determine card gradient based on organization name or index
  const getCardTheme = (orgName: string = '') => {
    const o = orgName.toLowerCase();
    if (o.includes('chase') || o.includes('sapphire')) {
      return {
        bg: 'from-slate-900 via-blue-950 to-indigo-950',
        border: 'border-blue-500/30',
        accent: 'text-blue-400',
        chip: 'from-amber-200 to-amber-500',
        tag: 'Sapphire Reserve',
      };
    }
    if (o.includes('abyssinia')) {
      return {
        bg: 'from-emerald-950 via-teal-950 to-slate-900',
        border: 'border-emerald-500/30',
        accent: 'text-emerald-400',
        chip: 'from-amber-200 to-amber-400',
        tag: 'Premier Emerald',
      };
    }
    if (o.includes('commercial bank') || o.includes('cbe')) {
      return {
        bg: 'from-purple-950 via-indigo-950 to-slate-900',
        border: 'border-purple-500/30',
        accent: 'text-purple-300',
        chip: 'from-amber-200 to-amber-500',
        tag: 'CBE Commercial',
      };
    }
    if (o.includes('telebirr') || o.includes('telecom')) {
      return {
        bg: 'from-cyan-950 via-slate-900 to-sky-950',
        border: 'border-cyan-500/30',
        accent: 'text-cyan-400',
        chip: 'from-amber-200 to-amber-400',
        tag: 'Telebirr Digital',
      };
    }
    return {
      bg: 'from-slate-900 via-zinc-900 to-slate-950',
      border: 'border-slate-700/50',
      accent: 'text-slate-300',
      chip: 'from-amber-200 to-amber-400',
      tag: 'Krypton Black',
    };
  };

  const theme = getCardTheme(account.orgName);

  if (!hasAtm) {
    // Mobile-Only Wallet Card representation
    return (
      <div className={`relative w-full aspect-[1.586/1] rounded-2xl bg-gradient-to-br ${theme.bg} border ${theme.border} p-5 shadow-2xl overflow-hidden flex flex-col justify-between text-white select-none`}>
        {/* Subtle mesh background circles */}
        <div className="absolute -top-12 -right-12 w-44 h-44 rounded-full bg-cyan-500/10 blur-2xl pointer-events-none" />
        <div className="absolute -bottom-8 -left-8 w-40 h-40 rounded-full bg-emerald-500/10 blur-2xl pointer-events-none" />

        {/* Top Header */}
        <div className="relative z-10 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-white/10 backdrop-blur-md flex items-center justify-center border border-white/10">
              <CreditCard className="w-4 h-4 text-emerald-400" />
            </div>
            <div>
              <p className="text-xs font-semibold tracking-wider uppercase text-slate-300">
                {account.orgName || 'Virtual Account'}
              </p>
              <p className="text-[10px] text-slate-400">Mobile Banking Wallet</p>
            </div>
          </div>
          <span className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-300">
            {account.currency}
          </span>
        </div>

        {/* Middle Account Number */}
        <div className="relative z-10 my-auto">
          <p className="text-[10px] uppercase font-mono tracking-widest text-slate-400 mb-1">
            Account Number
          </p>
          <div className="flex items-center justify-between group">
            <span className="font-mono text-lg tracking-wider text-slate-100 font-bold tabular-nums">
              {account.accountNumber}
            </span>
            <button
              onClick={(e) => handleCopy(e, account.accountNumber, 'Account Number')}
              aria-label="Copy Account Number"
              className="p-1.5 rounded-lg bg-white/10 hover:bg-white/20 transition-colors text-slate-300"
            >
              {copiedField === 'Account Number' ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
            </button>
          </div>
        </div>

        {/* Bottom Details */}
        <div className="relative z-10 flex items-end justify-between pt-2 border-t border-white/10">
          <div>
            <p className="text-[9px] uppercase tracking-wider text-slate-400">Account Holder</p>
            <p className="text-sm font-semibold tracking-wide text-slate-100 truncate max-w-[200px]">
              {account.name}
            </p>
          </div>
          <div className="text-right">
            <p className="text-[9px] uppercase tracking-wider text-slate-400">Balance</p>
            <p className="text-base font-bold font-mono tracking-tight text-emerald-300 tabular-nums">
              {new Intl.NumberFormat('en-US', { style: 'currency', currency: account.currency || 'USD' }).format(account.currentBalance)}
            </p>
          </div>
        </div>
      </div>
    );
  }

  // Virtual ATM / Debit Card with 3D Flip
  return (
    <div className="relative w-full aspect-[1.586/1] perspective-1000 select-none">
      <motion.div
        className="w-full h-full relative"
        style={{ transformStyle: 'preserve-3d' }}
        animate={{ rotateY: isFlipped ? 180 : 0 }}
        transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
      >
        {/* ================= FRONT SIDE ================= */}
        <div
          style={{ backfaceVisibility: 'hidden', WebkitBackfaceVisibility: 'hidden' }}
          className={`absolute inset-0 w-full h-full rounded-2xl bg-gradient-to-br ${theme.bg} border ${theme.border} p-5 shadow-2xl overflow-hidden flex flex-col justify-between text-white backface-hidden ${
            isFlipped ? 'pointer-events-none' : 'pointer-events-auto'
          }`}
        >
          {/* Holographic light effect */}
          <div className="absolute -top-16 -right-16 w-48 h-48 rounded-full bg-white/10 blur-3xl pointer-events-none" />

          {/* Top Bar: Bank Logo, Contactless wave & Flip button */}
          <div className="flex items-center justify-between relative z-10">
            <div>
              <p className="text-sm font-bold tracking-wider text-slate-100 uppercase">
                {account.orgName || 'Krypton Vault'}
              </p>
              <p className="text-[10px] text-slate-400">{account.branchName || theme.tag}</p>
            </div>
            <div className="flex items-center gap-2">
              <Wifi className="w-5 h-5 text-slate-400 rotate-90" aria-label="Contactless" />
              <button
                type="button"
                onClick={toggleFlip}
                aria-label="Flip card to view CVV and back"
                className="p-1.5 rounded-lg bg-white/10 hover:bg-white/20 active:scale-95 transition-all text-slate-300 flex items-center gap-1 text-xs cursor-pointer"
              >
                <RotateCw className="w-3.5 h-3.5" />
                <span className="text-[10px]">Back</span>
              </button>
            </div>
          </div>

          {/* EMV Metallic Chip */}
          <div className="relative z-10 flex items-center justify-between">
            <div className="w-11 h-8 rounded-md bg-gradient-to-tr from-amber-300 via-amber-200 to-amber-500 border border-amber-600/40 shadow-inner flex flex-col justify-center gap-1 p-1">
              <div className="w-full h-[1px] bg-amber-700/60" />
              <div className="w-full h-[1px] bg-amber-700/60" />
            </div>

            {/* Eye unmask toggle */}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={toggleReveal}
                aria-label={showSensitiveDetails ? 'Hide card number' : 'Reveal card number'}
                className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-full bg-white/10 hover:bg-white/20 text-slate-200 backdrop-blur-md transition-colors cursor-pointer"
              >
                {showSensitiveDetails ? (
                  <>
                    <EyeOff className="w-3.5 h-3.5 text-amber-400" />
                    <span className="text-[10px] font-mono text-amber-300">Mask</span>
                  </>
                ) : (
                  <>
                    <Eye className="w-3.5 h-3.5 text-slate-300" />
                    <span className="text-[10px]">Reveal</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Card Number */}
          <div className="relative z-10">
            <p className="text-[9px] uppercase font-mono tracking-widest text-slate-400 mb-0.5">
              Card Number
            </p>
            <div className="flex items-center justify-between">
              <span className="font-mono text-lg sm:text-xl font-bold tracking-widest text-slate-100 tabular-nums">
                {showSensitiveDetails && isUnlocked
                  ? formatCardNumber(atm.atmNumber || '')
                  : maskCardNumber(atm.atmNumber)}
              </span>
              <button
                type="button"
                onClick={(e) => handleCopy(e, atm.atmNumber, 'Card Number')}
                aria-label="Copy Card Number"
                className="p-1.5 rounded-lg bg-white/10 hover:bg-white/20 active:scale-95 transition-all text-slate-300 cursor-pointer"
              >
                {copiedField === 'Card Number' ? (
                  <Check className="w-4 h-4 text-emerald-400" />
                ) : (
                  <Copy className="w-4 h-4" />
                )}
              </button>
            </div>
          </div>

          {/* Bottom Row: Cardholder, Expiry, Card Network */}
          <div className="flex items-end justify-between relative z-10 pt-2 border-t border-white/10">
            <div>
              <p className="text-[9px] uppercase tracking-wider text-slate-400">Cardholder</p>
              <p className="text-xs sm:text-sm font-semibold tracking-wide text-slate-100 uppercase truncate max-w-[170px]">
                {account.name}
              </p>
            </div>
            <div className="text-center">
              <p className="text-[9px] uppercase tracking-wider text-slate-400">Expires</p>
              <p className="text-xs font-mono font-semibold tracking-wider text-slate-200">
                {atm.expiry || '12/29'}
              </p>
            </div>
            <div className="text-right flex flex-col items-end">
              <p className="text-[9px] uppercase tracking-wider text-slate-400 font-mono">
                {network.toUpperCase()}
              </p>
              <div className="flex items-center gap-1 mt-0.5">
                <span className="w-5 h-5 rounded-full bg-red-500/80 -mr-2 shadow-sm" />
                <span className="w-5 h-5 rounded-full bg-amber-500/80 shadow-sm" />
              </div>
            </div>
          </div>
        </div>

        {/* ================= BACK SIDE ================= */}
        <div
          style={{
            backfaceVisibility: 'hidden',
            WebkitBackfaceVisibility: 'hidden',
            transform: 'rotateY(180deg)',
          }}
          className={`absolute inset-0 w-full h-full rounded-2xl bg-gradient-to-br from-slate-950 via-zinc-900 to-black border ${theme.border} p-5 shadow-2xl flex flex-col justify-between text-white backface-hidden ${
            isFlipped ? 'pointer-events-auto z-20' : 'pointer-events-none'
          }`}
        >
          {/* Magnetic Stripe */}
          <div className="-mx-5 -mt-2 h-10 bg-slate-950 border-y border-slate-800 flex items-center justify-between px-4">
            <span className="text-[9px] font-mono text-slate-600 tracking-widest">
              KRYPTON ENCRYPTED MAGNETIC STRIPE • SHA-256
            </span>
            <button
              type="button"
              onClick={toggleReveal}
              className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-white/10 hover:bg-white/20 text-slate-200 transition-colors cursor-pointer"
            >
              {showSensitiveDetails ? (
                <>
                  <EyeOff className="w-3 h-3 text-amber-400" />
                  <span className="font-mono text-amber-300">Mask</span>
                </>
              ) : (
                <>
                  <Eye className="w-3 h-3 text-slate-300" />
                  <span>Reveal CVV</span>
                </>
              )}
            </button>
          </div>

          {/* Signature Panel & CVV */}
          <div className="my-2">
            <div className="flex items-center justify-between mb-1">
              <p className="text-[9px] uppercase tracking-wider text-slate-400">Authorized Signature</p>
              <p className="text-[9px] uppercase tracking-wider text-slate-400">Security CVV</p>
            </div>
            <div className="flex items-center gap-3">
              {/* Signature Strip */}
              <div className="flex-1 h-9 rounded bg-slate-200/90 flex items-center px-3 font-serif italic text-slate-800 text-xs shadow-inner truncate">
                {account.name}
              </div>
              {/* CVV Box */}
              <div className="w-16 h-9 rounded bg-white text-slate-900 font-mono font-bold text-sm flex items-center justify-center border border-slate-300 shadow-inner">
                {showSensitiveDetails && isUnlocked ? atm.cvv || '•••' : '•••'}
              </div>
              <button
                type="button"
                onClick={(e) => handleCopy(e, atm.cvv, 'CVV')}
                aria-label="Copy CVV"
                className="p-2 rounded bg-white/10 hover:bg-white/20 text-slate-300 cursor-pointer"
              >
                {copiedField === 'CVV' ? (
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                ) : (
                  <Copy className="w-3.5 h-3.5" />
                )}
              </button>
            </div>
          </div>

          {/* Back Info & Flip Back Button */}
          <div className="pt-2 border-t border-slate-800 flex items-center justify-between text-[10px] text-slate-400">
            <div className="flex items-center gap-1">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
              <span>Zero-Knowledge Protected</span>
            </div>
            <button
              type="button"
              onClick={toggleFlip}
              aria-label="Flip back to card front"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/30 text-emerald-300 font-semibold transition-all active:scale-95 cursor-pointer"
            >
              <RotateCw className="w-3.5 h-3.5" />
              <span>Front</span>
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );
};

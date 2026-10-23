import React, { useState } from 'react';
import { CreditCard, Plus, Shield, AlertTriangle } from 'lucide-react';
import { AccountRecord, SupportedLanguage } from '../types/account';
import { VirtualCard } from './VirtualCard';
import { translations } from '../utils/i18n';

interface CardsViewProps {
  accounts: AccountRecord[];
  onSelectAccount: (account: AccountRecord) => void;
  onAddNewAccount: () => void;
  isUnlocked: boolean;
  currentLanguage: SupportedLanguage;
}

export const CardsView: React.FC<CardsViewProps> = ({
  accounts,
  onSelectAccount,
  onAddNewAccount,
  isUnlocked,
  currentLanguage,
}) => {
  const t = translations[currentLanguage];
  const [selectedIdx, setSelectedIdx] = useState(0);

  const atmAccounts = accounts.filter((a) => a.atm?.hasAtm);
  const activeAccount = atmAccounts[selectedIdx] || atmAccounts[0];

  return (
    <div className="space-y-6 pb-20">
      {/* Top Header */}
      <div className="flex items-center justify-between">
        <div>
          <span className="text-[10px] font-mono tracking-widest text-emerald-400">
            Tactile Wallet
          </span>
          <h3 className="text-xl font-bold text-slate-100">{t.virtualCards}</h3>
        </div>
        <button
          type="button"
          onClick={onAddNewAccount}
          className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-md shadow-emerald-950 transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>New Card Reference</span>
        </button>
      </div>

      {/* Security Advisory Warning on Storing Full Card Numbers */}
      <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-start gap-3 text-xs text-amber-200">
        <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
        <div className="space-y-1">
          <p className="font-bold text-amber-300">
            Security Advisory: Do Not Store Full Bank Card Numbers
          </p>
          <p className="text-slate-300 leading-relaxed">
            Bank card numbers (PAN) and CVVs should not be stored in full in a home-built vault. Store only the <strong className="text-white">last 4 digits</strong> and the <strong className="text-white">card name</strong> for reference, and keep full payment card details in a dedicated hardware-audited password manager.
          </p>
        </div>
      </div>

      {atmAccounts.length > 0 ? (
        <div className="space-y-6">
          {/* Card Carousel Selector */}
          <div className="flex items-center gap-2 overflow-x-auto pb-1 no-scrollbar">
            {atmAccounts.map((acc, idx) => (
              <button
                key={acc.id}
                type="button"
                onClick={() => setSelectedIdx(idx)}
                className={`px-3 py-1.5 rounded-xl text-xs font-mono font-medium whitespace-nowrap transition-all ${
                  selectedIdx === idx
                    ? 'bg-emerald-600 text-white shadow-md shadow-emerald-950'
                    : 'bg-slate-900 border border-slate-800 text-slate-400 hover:text-slate-200'
                }`}
              >
                {acc.orgName || acc.name} · #{acc.accountNumber.slice(-4)}
              </button>
            ))}
          </div>

          {/* Active Featured Card with Full 3D Interactive Flip (Manageable size on PC/Tablet, full width on Phone) */}
          {activeAccount && (
            <div className="flex flex-col md:flex-row md:items-stretch gap-5">
              <div className="w-full max-w-[380px] mx-auto md:mx-0 md:w-[360px] lg:w-[380px] shrink-0">
                <VirtualCard account={activeAccount} isUnlocked={isUnlocked} />
              </div>

              {/* Card Meta & Inspector Trigger */}
              <div className="flex-1 p-5 rounded-2xl bg-[#0c1220] border border-slate-800 flex flex-col justify-between gap-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <span className="text-[10px] font-mono uppercase tracking-wider text-emerald-400">
                      Active Card Inspector
                    </span>
                    <h4 className="text-base font-bold text-slate-100 mt-0.5">{activeAccount.name}</h4>
                    <p className="text-xs text-slate-400">
                      {activeAccount.orgName} · {activeAccount.branchName || 'Primary Branch'}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => onSelectAccount(activeAccount)}
                    className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold transition-colors shrink-0"
                  >
                    View Details &amp; Ledger
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-3 text-xs pt-3 border-t border-slate-800/80">
                  <div className="p-3 rounded-xl bg-slate-950 border border-slate-800/80">
                    <span className="text-[10px] font-mono text-slate-400">Card Network</span>
                    <p className="font-mono font-semibold text-slate-200 uppercase mt-0.5">
                      {activeAccount.atm?.cardNetwork || 'Generic'}
                    </p>
                  </div>
                  <div className="p-3 rounded-xl bg-slate-950 border border-slate-800/80">
                    <span className="text-[10px] font-mono text-slate-400">Card Status</span>
                    <p className="font-mono font-semibold text-emerald-400 flex items-center gap-1 mt-0.5">
                      <Shield className="w-3 h-3 shrink-0" />
                      <span>Active &amp; Masked</span>
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Cards Stack (All cards listing) */}
          <div className="space-y-3 pt-2">
            <h4 className="text-xs font-bold text-slate-400 font-mono">
              All Saved Cards ({atmAccounts.length})
            </h4>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {atmAccounts.map((acc, index) => (
                <div
                  key={acc.id}
                  onClick={() => {
                    setSelectedIdx(index);
                    onSelectAccount(acc);
                  }}
                  className={`p-3.5 rounded-2xl border flex items-center justify-between cursor-pointer transition-all active:scale-[0.99] ${
                    selectedIdx === index
                      ? 'bg-slate-900 border-emerald-500/40'
                      : 'bg-slate-900/60 hover:bg-slate-900 border-slate-800'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-10 h-10 rounded-xl bg-slate-800 flex items-center justify-center border border-slate-700/60 shrink-0">
                      <CreditCard className="w-5 h-5 text-emerald-400" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-slate-200 truncate">{acc.name}</p>
                      <p className="text-[10px] text-slate-400 font-mono truncate">
                        {acc.atm?.atmNumber
                          ? `Ending in •••• ${acc.atm.atmNumber.slice(-4)}`
                          : 'Card Linked'}
                      </p>
                    </div>
                  </div>
                  <div className="text-right shrink-0 ml-2">
                    <span className="text-xs font-mono font-bold text-slate-100 block truncate max-w-[110px]">
                      {acc.orgName || 'Bank'}
                    </span>
                    <p className="text-[10px] text-emerald-400 font-mono">Tap to inspect</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <div className="text-center py-16 space-y-4 p-6 rounded-3xl bg-slate-900/40 border border-slate-800">
          <div className="w-16 h-16 rounded-2xl bg-slate-800/80 flex items-center justify-center mx-auto text-slate-400">
            <CreditCard className="w-8 h-8" />
          </div>
          <div>
            <h4 className="text-base font-bold text-slate-200">No ATM / Debit Cards Added</h4>
            <p className="text-xs text-slate-400 max-w-xs mx-auto mt-1">
              Add your first bank account with card reference details (last 4 digits recommended).
            </p>
          </div>
          <button
            type="button"
            onClick={onAddNewAccount}
            className="px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold transition-colors"
          >
            Add Bank Account with Card
          </button>
        </div>
      )}
    </div>
  );
};

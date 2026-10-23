import React, { useState, useEffect } from 'react';
import {
  ArrowDownLeft,
  ArrowUpRight,
  Sparkles,
  Loader2,
  SlidersHorizontal,
  RefreshCw,
  Plus,
  Trash2,
  HelpCircle,
  Check,
  Wallet,
} from 'lucide-react';
import {
  AccountRecord,
  ExchangeRatesConfig,
  SupportedLanguage,
  TransactionRecord,
} from '../types/account';
import { formatCurrency } from '../utils/validator';
import { translations } from '../utils/i18n';
import { resolveApiUrl } from '../firebase';

interface FinanceViewProps {
  accounts: AccountRecord[];
  onSelectAccount: (account: AccountRecord) => void;
  onAddTransaction: (
    accountId: string,
    tx: Omit<TransactionRecord, 'id' | 'accountId'>
  ) => void;
  onDeleteTransaction: (accountId: string, txId: string) => void;
  currentLanguage: SupportedLanguage;
  exchangeConfig: ExchangeRatesConfig;
  onUpdateExchangeConfig: (cfg: ExchangeRatesConfig) => void;
  convertAmount: (amount: number, fromCurrency: string, toCurrency: string) => number;
}

interface AiInsightResponse {
  headline: string;
  healthRating: string;
  insights: {
    title: string;
    detail: string;
    action: string;
  }[];
}

const EXPENSE_CATEGORY_PRESETS = [
  'Hosting & Cloud',
  'Domain & SSL',
  'Food & Dining',
  'Telecom & Internet',
  'Rent & Utilities',
  'Office & SaaS Tools',
  'Transfer Out',
  'Shopping',
  'Transport & Fuel',
  'Taxes & Bank Fees',
];

const INCOME_CATEGORY_PRESETS = [
  'SaaS Subscription Revenue',
  'Client Project Payment',
  'Salary / Deposit',
  'Shop / POS Sales',
  'Transfer In',
  'Refund / Cashback',
  'Dividend & Interest',
];

export const FinanceView: React.FC<FinanceViewProps> = ({
  accounts,
  onSelectAccount,
  onAddTransaction,
  onDeleteTransaction,
  currentLanguage,
  exchangeConfig,
  onUpdateExchangeConfig,
  convertAmount,
}) => {
  const t = translations[currentLanguage];
  const [filterType, setFilterType] = useState<'all' | 'income' | 'expense'>('all');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [showRatesEditor, setShowRatesEditor] = useState(false);
  const [showHowItWorks, setShowHowItWorks] = useState(false);

  // Direct Add Income / Expense Form State
  const [showAddForm, setShowAddForm] = useState(true);
  const [targetAccountId, setTargetAccountId] = useState<string>(accounts[0]?.id || '');
  const [txType, setTxType] = useState<'expense' | 'income'>('expense');
  const [txAmountInput, setTxAmountInput] = useState<string>('');
  const [txCategory, setTxCategory] = useState<string>('Hosting & Cloud');
  const [txNote, setTxNote] = useState<string>('');
  const [txDate, setTxDate] = useState<string>(() => new Date().toISOString().split('T')[0]);
  const [txSavedFeedback, setTxSavedFeedback] = useState(false);

  useEffect(() => {
    if (!targetAccountId && accounts.length > 0) {
      setTargetAccountId(accounts[0].id);
    } else if (targetAccountId && !accounts.some((a) => a.id === targetAccountId)) {
      setTargetAccountId(accounts[0]?.id || '');
    }
  }, [accounts, targetAccountId]);

  const handleTxTypeSwitch = (nextType: 'expense' | 'income') => {
    setTxType(nextType);
    if (nextType === 'expense' && INCOME_CATEGORY_PRESETS.includes(txCategory)) {
      setTxCategory(EXPENSE_CATEGORY_PRESETS[0]);
    } else if (nextType === 'income' && EXPENSE_CATEGORY_PRESETS.includes(txCategory)) {
      setTxCategory(INCOME_CATEGORY_PRESETS[0]);
    }
  };

  const handleAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let val = e.target.value;
    if (val === '') {
      setTxAmountInput('');
      return;
    }
    val = val.replace(/[^0-9.]/g, '');
    const parts = val.split('.');
    if (parts.length > 2) {
      val = `${parts[0]}.${parts.slice(1).join('')}`;
    }
    val = val.replace(/^0+(?=\d)/, '');
    setTxAmountInput(val);
  };

  const handleRecordTransaction = (e: React.FormEvent) => {
    e.preventDefault();
    const numericAmount = parseFloat(txAmountInput);
    if (!targetAccountId || !Number.isFinite(numericAmount) || numericAmount <= 0) return;

    onAddTransaction(targetAccountId, {
      type: txType,
      amount: numericAmount,
      category: txCategory.trim() || (txType === 'income' ? 'Addition' : 'Expense'),
      date: txDate || new Date().toISOString().split('T')[0],
      note: txNote.trim() || undefined,
    });

    setTxAmountInput('');
    setTxNote('');
    setTxSavedFeedback(true);
    setTimeout(() => setTxSavedFeedback(false), 2500);
  };

  // AI Insights State
  const [aiInsights, setAiInsights] = useState<AiInsightResponse | null>(null);
  const [isGeneratingAi, setIsGeneratingAi] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  // Collect all transactions across all accounts
  const allTransactions: (TransactionRecord & { accountName: string; currency: string })[] = [];
  accounts.forEach((acc) => {
    (acc.transactions || []).forEach((tx) => {
      allTransactions.push({
        ...tx,
        accountId: acc.id,
        accountName: acc.name,
        currency: acc.currency,
      });
    });
  });

  // Sort descending by date
  allTransactions.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  // Total Inflows & Outflows in Base Currency
  const totalIncomeInBase = allTransactions
    .filter((tx) => tx.type === 'income')
    .reduce(
      (sum, tx) => sum + convertAmount(tx.amount, tx.currency, exchangeConfig.baseCurrency),
      0
    );

  const totalExpenseInBase = allTransactions
    .filter((tx) => tx.type === 'expense')
    .reduce(
      (sum, tx) => sum + convertAmount(tx.amount, tx.currency, exchangeConfig.baseCurrency),
      0
    );

  // Aggregate balances by currency
  const balancesByCurrency: Record<string, number> = {};
  accounts.forEach((acc) => {
    balancesByCurrency[acc.currency] = (balancesByCurrency[acc.currency] || 0) + acc.currentBalance;
  });

  // Total Net Worth converted into Primary Base Currency
  const totalInBaseCurrency = accounts.reduce(
    (sum, acc) =>
      sum + convertAmount(acc.currentBalance, acc.currency, exchangeConfig.baseCurrency),
    0
  );

  // Filtered transactions
  const filtered = allTransactions.filter((tx) => {
    if (filterType !== 'all' && tx.type !== filterType) return false;
    if (selectedCategory !== 'all' && tx.category !== selectedCategory) return false;
    return true;
  });

  // Unique categories
  const categories = Array.from(new Set(allTransactions.map((tx) => tx.category))).filter(Boolean);

  const selectedTargetAccount = accounts.find((a) => a.id === targetAccountId);
  const activePresets = txType === 'expense' ? EXPENSE_CATEGORY_PRESETS : INCOME_CATEGORY_PRESETS;

  const handleGenerateAiInsights = async () => {
    setIsGeneratingAi(true);
    setAiError(null);
    try {
      // Strictly anonymize: only send currency totals and category totals!
      const categoryTotals: Record<string, { income: number; expense: number }> = {};
      allTransactions.forEach((tx) => {
        const converted = convertAmount(tx.amount, tx.currency, exchangeConfig.baseCurrency);
        if (!categoryTotals[tx.category]) {
          categoryTotals[tx.category] = { income: 0, expense: 0 };
        }
        if (tx.type === 'income') categoryTotals[tx.category].income += converted;
        else categoryTotals[tx.category].expense += converted;
      });

      const summaryPayload = {
        totalNetWorthInBaseCurrency: Math.round(totalInBaseCurrency * 100) / 100,
        baseCurrency: exchangeConfig.baseCurrency,
        holdingsByCurrency: balancesByCurrency,
        accountCount: accounts.length,
        categoryCashflowInBase: categoryTotals,
      };

      const res = await fetch(resolveApiUrl('/api/ai/insights'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          summaryPayload,
          baseCurrency: exchangeConfig.baseCurrency,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Could not generate insights.');
      }
      setAiInsights(data);
    } catch (err: any) {
      setAiError(err.message || 'AI insights unavailable while offline.');
    } finally {
      setIsGeneratingAi(false);
    }
  };

  return (
    <div className="space-y-6 pb-20">
      {/* Top Total Balance Summary by Base Currency & Exchange Rates */}
      <div className="p-5 rounded-3xl bg-gradient-to-br from-[#0e172a] via-[#0b1322] to-[#040810] border border-slate-800 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <span className="text-[11px] font-mono text-emerald-400">
              Converted Net Worth ({exchangeConfig.baseCurrency} Base)
            </span>
            <h3 className="text-2xl sm:text-3xl font-extrabold font-mono text-slate-100 tabular-nums mt-0.5">
              {formatCurrency(totalInBaseCurrency, exchangeConfig.baseCurrency)}
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              1 USD = {exchangeConfig.ratesPerUsd.ETB || 128.5} ETB ·{' '}
              {Object.keys(balancesByCurrency).length} active currencies
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Base Currency Selector */}
            <select
              aria-label="Primary Base Currency"
              value={exchangeConfig.baseCurrency}
              onChange={(e) =>
                onUpdateExchangeConfig({
                  ...exchangeConfig,
                  baseCurrency: e.target.value,
                })
              }
              className="h-9 px-3 rounded-xl bg-slate-900 border border-slate-700 text-xs font-mono font-bold text-emerald-400 focus:outline-none focus:border-emerald-500"
            >
              <option value="ETB">Base: ETB</option>
              <option value="USD">Base: USD</option>
              <option value="EUR">Base: EUR</option>
              <option value="GBP">Base: GBP</option>
            </select>

            <button
              type="button"
              onClick={() => setShowRatesEditor(!showRatesEditor)}
              className="h-9 px-3 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-800 text-xs font-medium text-slate-300 flex items-center gap-1.5 transition-colors"
            >
              <SlidersHorizontal className="w-3.5 h-3.5 text-emerald-400" />
              <span>FX Rates</span>
            </button>

            <button
              type="button"
              onClick={() => setShowHowItWorks(!showHowItWorks)}
              className="h-9 px-3 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-800 text-xs font-medium text-slate-300 flex items-center gap-1.5 transition-colors"
            >
              <HelpCircle className="w-3.5 h-3.5 text-cyan-400" />
              <span>How Ledger Works</span>
            </button>
          </div>
        </div>

        {/* How Ledger Works Explanation Banner */}
        {showHowItWorks && (
          <div className="p-4 rounded-2xl bg-slate-950/90 border border-cyan-500/30 space-y-2 text-xs text-slate-300 animate-fade-in">
            <p className="font-bold text-cyan-300 flex items-center gap-1.5">
              <HelpCircle className="w-4 h-4" />
              How the Krypton Zero-Knowledge Ledger Works:
            </p>
            <ul className="list-disc list-inside space-y-1 text-[11px] text-slate-300 leading-relaxed">
              <li>
                <strong>Direct Balance Sync:</strong> Every time you record an{' '}
                <span className="text-emerald-400 font-semibold">Addition / Income (+)</span> or{' '}
                <span className="text-rose-400 font-semibold">Expense (-)</span> below, the selected bank account or wallet balance automatically increases or decreases by that exact amount.
              </li>
              <li>
                <strong>Multi-Currency Conversion:</strong> Each transaction is stored in the account&apos;s native currency (e.g. ETB or USD) and automatically converted to your Base Currency ({exchangeConfig.baseCurrency}) for net-worth and cashflow totals.
              </li>
              <li>
                <strong>Reversible Entries:</strong> Deleting any transaction from the feed automatically reverses its effect on that account&apos;s balance.
              </li>
            </ul>
          </div>
        )}

        {/* Custom Exchange Rate Editor */}
        {showRatesEditor && (
          <div className="p-4 rounded-2xl bg-slate-950/90 border border-slate-800 space-y-3 animate-fade-in">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-slate-200">
                Custom Exchange Rates (per 1 USD)
              </p>
              <span className="text-[10px] font-mono text-slate-400">
                Saved offline to local vault
              </span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              {(['ETB', 'EUR', 'GBP', 'CAD'] as const).map((curr) => (
                <div key={curr}>
                  <label className="block text-[10px] font-mono text-slate-400 mb-1">
                    1 USD in {curr}
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={exchangeConfig.ratesPerUsd[curr] ?? 1}
                    onChange={(e) => {
                      const val = parseFloat(e.target.value);
                      if (val > 0) {
                        onUpdateExchangeConfig({
                          ...exchangeConfig,
                          ratesPerUsd: {
                            ...exchangeConfig.ratesPerUsd,
                            [curr]: val,
                          },
                        });
                      }
                    }}
                    className="w-full h-9 px-2.5 rounded-lg bg-slate-900 border border-slate-700 text-xs font-mono text-slate-100 focus:outline-none focus:border-emerald-500"
                  />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Currency balances & Inflow/Outflow summary grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
          {Object.entries(balancesByCurrency).map(([curr, sum]) => (
            <div key={curr} className="p-3 rounded-2xl bg-slate-900/80 border border-slate-800">
              <span className="text-[10px] font-mono text-slate-400">{curr} Holdings</span>
              <p className="text-base sm:text-lg font-mono font-bold text-slate-100 tabular-nums">
                {formatCurrency(sum, curr)}
              </p>
              {curr !== exchangeConfig.baseCurrency && (
                <p className="text-[10px] font-mono text-slate-500 tabular-nums mt-0.5">
                  ≈{' '}
                  {formatCurrency(
                    convertAmount(sum, curr, exchangeConfig.baseCurrency),
                    exchangeConfig.baseCurrency
                  )}
                </p>
              )}
            </div>
          ))}

          <div className="p-3 rounded-2xl bg-emerald-950/20 border border-emerald-500/20">
            <span className="text-[10px] font-mono text-emerald-400">Total Additions (+)</span>
            <p className="text-base sm:text-lg font-mono font-bold text-emerald-300 tabular-nums">
              +{formatCurrency(totalIncomeInBase, exchangeConfig.baseCurrency)}
            </p>
          </div>

          <div className="p-3 rounded-2xl bg-rose-950/20 border border-rose-500/20">
            <span className="text-[10px] font-mono text-rose-400">Total Expenses (-)</span>
            <p className="text-base sm:text-lg font-mono font-bold text-rose-300 tabular-nums">
              -{formatCurrency(totalExpenseInBase, exchangeConfig.baseCurrency)}
            </p>
          </div>
        </div>
      </div>

      {/* ================= DIRECT RECORD INCOME / EXPENSE PANEL ================= */}
      <div className="p-5 rounded-3xl bg-[#0c1220] border border-slate-800 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h4 className="text-sm font-bold text-slate-100 flex items-center gap-2">
              <Plus className="w-4 h-4 text-emerald-400" />
              Record Expense or Addition (Income)
            </h4>
            <p className="text-xs text-slate-400">
              Log an expense or deposit directly and auto-update your account balance
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowAddForm(!showAddForm)}
            className="px-3 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-800 text-xs font-medium text-slate-300 transition-colors"
          >
            {showAddForm ? 'Collapse Form' : '+ Open Entry Form'}
          </button>
        </div>

        {showAddForm && (
          <>
            {accounts.length === 0 ? (
              <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 text-center space-y-2">
                <Wallet className="w-6 h-6 text-emerald-400 mx-auto" />
                <p className="text-xs font-semibold text-slate-200">
                  Add a Bank Account or Mobile Wallet first
                </p>
                <p className="text-[11px] text-slate-400">
                  Ledger transactions are linked to your accounts so balances stay accurate. Add an account in the Vault tab first.
                </p>
              </div>
            ) : (
              <form onSubmit={handleRecordTransaction} className="space-y-4 pt-1">
                {/* 1. Type Switcher (Expense vs Addition/Income) & Account Selector */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1">
                      Transaction Type
                    </label>
                    <div className="grid grid-cols-2 gap-2 p-1 rounded-xl bg-slate-950 border border-slate-800">
                      <button
                        type="button"
                        onClick={() => handleTxTypeSwitch('expense')}
                        className={`py-2 px-3 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-all ${
                          txType === 'expense'
                            ? 'bg-rose-600 text-white shadow'
                            : 'text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        <ArrowUpRight className="w-4 h-4" />
                        <span>Expense (- Out)</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleTxTypeSwitch('income')}
                        className={`py-2 px-3 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-all ${
                          txType === 'income'
                            ? 'bg-emerald-600 text-white shadow'
                            : 'text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        <ArrowDownLeft className="w-4 h-4" />
                        <span>Addition / Income (+)</span>
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1">
                      Select Account / Wallet
                    </label>
                    <select
                      value={targetAccountId}
                      onChange={(e) => setTargetAccountId(e.target.value)}
                      className="w-full h-10 px-3 rounded-xl bg-slate-950 border border-slate-800 text-xs font-semibold text-slate-100 focus:outline-none focus:border-emerald-500"
                    >
                      {accounts.map((acc) => (
                        <option key={acc.id} value={acc.id}>
                          {acc.name} ({acc.orgName || 'Vault'}) — Bal:{' '}
                          {formatCurrency(acc.currentBalance, acc.currency)}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* 2. Amount, Category, Date, Note */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1">
                      Amount ({selectedTargetAccount?.currency || 'ETB'}){' '}
                      <span className="text-emerald-400">*</span>
                    </label>
                    <input
                      type="text"
                      inputMode="decimal"
                      required
                      value={txAmountInput}
                      onChange={handleAmountChange}
                      placeholder="0.00"
                      className="w-full h-10 px-3 rounded-xl bg-slate-950 border border-slate-800 text-sm font-mono font-bold text-slate-100 placeholder-slate-500 focus:outline-none focus:border-emerald-500"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1">
                      Category
                    </label>
                    <input
                      type="text"
                      value={txCategory}
                      onChange={(e) => setTxCategory(e.target.value)}
                      placeholder="e.g. Hosting, Salary, Food..."
                      className="w-full h-10 px-3 rounded-xl bg-slate-950 border border-slate-800 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-emerald-500"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1">Date</label>
                    <input
                      type="date"
                      value={txDate}
                      onChange={(e) => setTxDate(e.target.value)}
                      className="w-full h-10 px-3 rounded-xl bg-slate-950 border border-slate-800 text-xs font-mono text-slate-200 focus:outline-none focus:border-emerald-500"
                    />
                  </div>
                </div>

                {/* Quick Category Chips */}
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[10px] font-mono text-slate-400 mr-1">Quick Category:</span>
                  {activePresets.map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => setTxCategory(preset)}
                      className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition-colors ${
                        txCategory === preset
                          ? txType === 'income'
                            ? 'bg-emerald-600 text-white'
                            : 'bg-rose-600 text-white'
                          : 'bg-slate-950 border border-slate-800 text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      {preset}
                    </button>
                  ))}
                </div>

                {/* Note & Submit Row */}
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
                  <input
                    type="text"
                    value={txNote}
                    onChange={(e) => setTxNote(e.target.value)}
                    placeholder="Optional note (e.g. Paid Cloudflare invoice, Pharmacy SaaS monthly renewal...)"
                    className="flex-1 h-10 px-3.5 rounded-xl bg-slate-950 border border-slate-800 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-emerald-500"
                  />

                  <button
                    type="submit"
                    className={`h-10 px-5 rounded-xl text-white text-xs font-semibold flex items-center justify-center gap-1.5 shadow-lg transition-all active:scale-95 shrink-0 ${
                      txType === 'income'
                        ? 'bg-emerald-600 hover:bg-emerald-500 shadow-emerald-950'
                        : 'bg-rose-600 hover:bg-rose-500 shadow-rose-950'
                    }`}
                  >
                    {txSavedFeedback ? (
                      <>
                        <Check className="w-4 h-4" />
                        <span>Recorded!</span>
                      </>
                    ) : (
                      <>
                        <Plus className="w-4 h-4" />
                        <span>
                          {txType === 'income' ? 'Record Addition (+)' : 'Record Expense (-)'}
                        </span>
                      </>
                    )}
                  </button>
                </div>
              </form>
            )}
          </>
        )}
      </div>

      {/* ================= AI SMART FINANCIAL INSIGHTS (FREE TIER GEMINI) ================= */}
      <div className="p-5 rounded-3xl bg-[#0c1220] border border-slate-800 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h4 className="text-sm font-bold text-slate-100 flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-emerald-400" />
              AI Personal Financial Intelligence
            </h4>
            <p className="text-xs text-slate-400">
              Zero-knowledge anonymized cashflow & currency exposure analysis (account numbers and PINs are never sent)
            </p>
          </div>
          <button
            type="button"
            onClick={handleGenerateAiInsights}
            disabled={isGeneratingAi || accounts.length === 0}
            className="px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold flex items-center gap-1.5 transition-all disabled:opacity-50"
          >
            {isGeneratingAi ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : aiInsights ? (
              <RefreshCw className="w-3.5 h-3.5" />
            ) : (
              <Sparkles className="w-3.5 h-3.5" />
            )}
            <span>
              {isGeneratingAi
                ? 'Analyzing Ledger...'
                : aiInsights
                ? 'Refresh Insights'
                : 'Analyze Ledger (AI)'}
            </span>
          </button>
        </div>

        {aiError && (
          <p className="text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-xl p-3">
            {aiError}
          </p>
        )}

        {aiInsights && (
          <div className="space-y-3 pt-2 border-t border-slate-800/80 animate-fade-in">
            <div className="flex items-center justify-between text-xs">
              <p className="font-semibold text-emerald-300">{aiInsights.headline}</p>
              <span className="font-mono text-slate-400 shrink-0 ml-2">
                Posture: {aiInsights.healthRating}
              </span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {aiInsights.insights.map((item, idx) => (
                <div
                  key={idx}
                  className="p-3.5 rounded-2xl bg-slate-950 border border-slate-800/90 space-y-1.5"
                >
                  <p className="text-xs font-bold text-slate-100">{item.title}</p>
                  <p className="text-[11px] text-slate-400 leading-relaxed">{item.detail}</p>
                  <p className="text-[11px] text-emerald-400 font-medium pt-1">
                    Action: {item.action}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Account Balances Strip */}
      <div className="space-y-3">
        <h4 className="text-xs font-bold text-slate-300 font-mono">
          Accounts Breakdown (Tap any account to view details)
        </h4>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {accounts.map((acc) => (
            <button
              key={acc.id}
              type="button"
              onClick={() => onSelectAccount(acc)}
              className="p-3.5 rounded-2xl bg-slate-900/60 hover:bg-slate-900 border border-slate-800 text-left transition-colors flex items-center justify-between group"
            >
              <div className="space-y-0.5 truncate pr-2">
                <p className="text-xs font-semibold text-slate-200 group-hover:text-emerald-400 transition-colors truncate">
                  {acc.name}
                </p>
                <p className="text-[10px] text-slate-400 font-mono">
                  {acc.orgName || 'Bank Vault'} · #{acc.accountNumber.slice(-4)}
                </p>
              </div>
              <div className="text-right shrink-0">
                <p className="text-sm font-mono font-bold text-slate-100 tabular-nums">
                  {formatCurrency(acc.currentBalance, acc.currency)}
                </p>
                <p className="text-[10px] text-slate-500 font-mono">
                  {acc.transactions?.length || 0} entries
                </p>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Transactions Feed with Filter */}
      <div className="p-5 rounded-3xl bg-[#0c1220] border border-slate-800 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h4 className="text-sm font-bold text-slate-100">Ledger Activity Feed</h4>
            <p className="text-xs text-slate-400">
              All recorded inflows (+) and outflows (-) across accounts ({filtered.length} shown)
            </p>
          </div>

          {/* Filter tabs */}
          <div className="flex items-center gap-1 p-1 bg-slate-900 border border-slate-800 rounded-xl self-start">
            <button
              type="button"
              onClick={() => setFilterType('all')}
              className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${
                filterType === 'all' ? 'bg-emerald-600 text-white' : 'text-slate-400 hover:text-white'
              }`}
            >
              All
            </button>
            <button
              type="button"
              onClick={() => setFilterType('income')}
              className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${
                filterType === 'income'
                  ? 'bg-emerald-600 text-white'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Additions (+)
            </button>
            <button
              type="button"
              onClick={() => setFilterType('expense')}
              className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${
                filterType === 'expense'
                  ? 'bg-rose-600 text-white'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Expenses (-)
            </button>
          </div>
        </div>

        {/* Category Filter Buttons */}
        {categories.length > 0 && (
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs">
            <button
              type="button"
              onClick={() => setSelectedCategory('all')}
              className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition-colors ${
                selectedCategory === 'all'
                  ? 'bg-slate-700 text-white'
                  : 'bg-slate-900 border border-slate-800 text-slate-400 hover:text-slate-200'
              }`}
            >
              All Categories
            </button>
            {categories.map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => setSelectedCategory(cat)}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-medium whitespace-nowrap transition-colors ${
                  selectedCategory === cat
                    ? 'bg-slate-700 text-white'
                    : 'bg-slate-900 border border-slate-800 text-slate-400 hover:text-slate-200'
                }`}
              >
                {cat}
              </button>
            ))}
          </div>
        )}

        {/* Transaction Rows */}
        <div className="space-y-2">
          {filtered.length > 0 ? (
            filtered.map((tx) => (
              <div
                key={tx.id}
                className="p-3 rounded-2xl bg-slate-950 border border-slate-800/80 flex items-center justify-between gap-2 text-xs"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div
                    className={`p-2 rounded-xl shrink-0 ${
                      tx.type === 'income'
                        ? 'bg-emerald-500/10 text-emerald-400'
                        : 'bg-rose-500/10 text-rose-400'
                    }`}
                  >
                    {tx.type === 'income' ? (
                      <ArrowDownLeft className="w-4 h-4" />
                    ) : (
                      <ArrowUpRight className="w-4 h-4" />
                    )}
                  </div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-semibold text-slate-200">{tx.category}</span>
                      <span className="text-[10px] text-slate-400 font-mono">
                        · {tx.accountName}
                      </span>
                    </div>
                    <p className="text-[10px] text-slate-400 mt-0.5 truncate">
                      {tx.date} {tx.note ? `— ${tx.note}` : ''}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2.5 shrink-0">
                  <span
                    className={`font-mono text-sm font-bold tabular-nums ${
                      tx.type === 'income' ? 'text-emerald-400' : 'text-rose-400'
                    }`}
                  >
                    {tx.type === 'income' ? '+' : '-'}
                    {formatCurrency(tx.amount, tx.currency)}
                  </span>
                  <button
                    type="button"
                    onClick={() => onDeleteTransaction(tx.accountId, tx.id)}
                    aria-label="Delete transaction and reverse balance"
                    title="Delete entry & reverse balance"
                    className="p-1.5 rounded-lg text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))
          ) : (
            <p className="text-xs text-slate-400 italic text-center py-6">
              No transactions recorded yet. Use the &ldquo;Record Expense or Addition&rdquo; form above to log your first entry!
            </p>
          )}
        </div>
      </div>
    </div>
  );
};

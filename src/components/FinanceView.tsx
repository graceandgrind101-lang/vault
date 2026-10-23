import React, { useState } from 'react';
import {
  TrendingUp,
  ArrowDownLeft,
  ArrowUpRight,
  Sparkles,
  Loader2,
  SlidersHorizontal,
  RefreshCw,
} from 'lucide-react';
import {
  AccountRecord,
  ExchangeRatesConfig,
  SupportedLanguage,
  TransactionRecord,
} from '../types/account';
import { formatCurrency } from '../utils/validator';
import { translations } from '../utils/i18n';

interface FinanceViewProps {
  accounts: AccountRecord[];
  onSelectAccount: (account: AccountRecord) => void;
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

export const FinanceView: React.FC<FinanceViewProps> = ({
  accounts,
  onSelectAccount,
  currentLanguage,
  exchangeConfig,
  onUpdateExchangeConfig,
  convertAmount,
}) => {
  const t = translations[currentLanguage];
  const [filterType, setFilterType] = useState<'all' | 'income' | 'expense'>('all');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [showRatesEditor, setShowRatesEditor] = useState(false);

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
        accountName: acc.name,
        currency: acc.currency,
      });
    });
  });

  // Sort descending by date
  allTransactions.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

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

      const res = await fetch('/api/ai/insights', {
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

          <div className="flex items-center gap-2">
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
          </div>
        </div>

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

        {/* Currency balances grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
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
        </div>
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
            <span>{isGeneratingAi ? 'Analyzing Ledger...' : aiInsights ? 'Refresh Insights' : 'Analyze Ledger (AI)'}</span>
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
        <h4 className="text-xs font-bold text-slate-300 font-mono">Accounts Breakdown</h4>
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
            <p className="text-xs text-slate-400">All recorded inflows and outflows across accounts</p>
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
              Income
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
              Expense
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
                className="p-3 rounded-2xl bg-slate-950 border border-slate-800/80 flex items-center justify-between text-xs"
              >
                <div className="flex items-center gap-3">
                  <div
                    className={`p-2 rounded-xl ${
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
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-slate-200">{tx.category}</span>
                      <span className="text-[10px] text-slate-500 font-mono">
                        · {tx.accountName}
                      </span>
                    </div>
                    <p className="text-[10px] text-slate-400 mt-0.5">
                      {tx.date} {tx.note ? `— ${tx.note}` : ''}
                    </p>
                  </div>
                </div>

                <span
                  className={`font-mono text-sm font-bold tabular-nums ${
                    tx.type === 'income' ? 'text-emerald-400' : 'text-rose-400'
                  }`}
                >
                  {tx.type === 'income' ? '+' : '-'}
                  {formatCurrency(tx.amount, tx.currency)}
                </span>
              </div>
            ))
          ) : (
            <p className="text-xs text-slate-500 italic text-center py-6">
              No transactions match the selected filter.
            </p>
          )}
        </div>
      </div>
    </div>
  );
};

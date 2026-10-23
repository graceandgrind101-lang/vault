import React from 'react';
import { Shield, CreditCard, Landmark, LineChart, KeyRound } from 'lucide-react';
import { SupportedLanguage } from '../types/account';
import { translations } from '../utils/i18n';

export type NavigationTab = 'vault' | 'secrets' | 'cards' | 'finance' | 'security';

interface BottomNavigationProps {
  currentTab: NavigationTab;
  onChangeTab: (tab: NavigationTab) => void;
  currentLanguage: SupportedLanguage;
}

export const BottomNavigation: React.FC<BottomNavigationProps> = ({
  currentTab,
  onChangeTab,
  currentLanguage,
}) => {
  const t = translations[currentLanguage];

  const tabs: { id: NavigationTab; label: string; icon: React.FC<{ className?: string }> }[] = [
    { id: 'vault', label: t.tabs.vault, icon: Landmark },
    { id: 'secrets', label: 'API Keys', icon: KeyRound },
    { id: 'cards', label: t.tabs.cards, icon: CreditCard },
    { id: 'finance', label: t.tabs.finance, icon: LineChart },
    { id: 'security', label: t.tabs.security, icon: Shield },
  ];

  const handleTabClick = (tabId: NavigationTab) => {
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      navigator.vibrate(20);
    }
    onChangeTab(tabId);
  };

  return (
    <nav
      aria-label="Bottom Navigation"
      className="fixed bottom-0 left-0 right-0 z-40 lg:hidden bg-[#080d18]/95 backdrop-blur-xl border-t border-slate-800/80 px-2 pb-safe"
    >
      <div className="max-w-lg mx-auto grid grid-cols-5 items-center h-16">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = currentTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => handleTabClick(tab.id)}
              className={`flex flex-col items-center justify-center min-h-[44px] min-w-[44px] py-1 transition-all ${
                isActive ? 'text-emerald-400' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <div className="relative">
                <Icon
                  className={`w-5 h-5 ${
                    isActive ? 'scale-110 text-emerald-400 stroke-[2.2]' : 'stroke-[1.8]'
                  }`}
                />
                {isActive && (
                  <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-emerald-400" />
                )}
              </div>
              <span className="text-[10px] font-medium tracking-tight mt-1 truncate max-w-[64px]">
                {tab.label}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
};

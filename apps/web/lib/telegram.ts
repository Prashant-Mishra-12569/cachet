'use client';

/**
 * Telegram Mini App bridge (core.telegram.org/bots/webapps). Only what Cachet uses.
 * The server checks Telegram's signed launch data (initData) on every request; nothing here is trusted.
 */

export interface TelegramWebApp {
  initData: string;
  colorScheme: 'light' | 'dark';
  platform: string;
  ready(): void;
  expand(): void;
  /** Opens an http(s) link outside Telegram; `try_browser` asks for a specific browser (Bot API 7.6+). */
  openLink(url: string, options?: { try_instant_view?: boolean; try_browser?: string }): void;
  onEvent(event: 'themeChanged', cb: () => void): void;
  offEvent(event: 'themeChanged', cb: () => void): void;
  BackButton: { show(): void; hide(): void; onClick(cb: () => void): void; offClick(cb: () => void): void };
  HapticFeedback?: {
    notificationOccurred(type: 'error' | 'success' | 'warning'): void;
    impactOccurred?(style: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft'): void;
  };
  /** Telegram's own top bar / background behind the app (Bot API 6.1+). */
  setHeaderColor?(color: string): void;
  setBackgroundColor?(color: string): void;
  /** Bottom bar colour (Bot API 7.10+). */
  setBottomBarColor?(color: string): void;
  isVersionAtLeast?(version: string): boolean;
}

/** Our brand colours for Telegram's own bars, so the app looks native in light and dark. */
export const BRAND_BG = { light: '#FAF8F5', dark: '#121411' } as const;

/** Paint Telegram's top bar and background in our colours (ignored on old Telegram versions). */
export function paintTelegram(tg: TelegramWebApp, scheme: 'light' | 'dark') {
  const color = BRAND_BG[scheme];
  try {
    if (tg.isVersionAtLeast?.('6.1') ?? true) {
      tg.setHeaderColor?.(color);
      tg.setBackgroundColor?.(color);
    }
    if (tg.isVersionAtLeast?.('7.10')) tg.setBottomBarColor?.(color);
  } catch {
    // Older Telegram apps: keep their default colours.
  }
}

declare global {
  interface Window {
    Telegram?: { WebApp?: TelegramWebApp };
  }
}

const SDK_URL = 'https://telegram.org/js/telegram-web-app.js?65';
let loading: Promise<TelegramWebApp | null> | null = null;

/** Load Telegram's script once. Resolves null outside Telegram (or if the script can't load). */
export function loadTelegram(): Promise<TelegramWebApp | null> {
  if (typeof window === 'undefined') return Promise.resolve(null);
  if (window.Telegram?.WebApp) return Promise.resolve(window.Telegram.WebApp);
  loading ??= new Promise((resolve) => {
    const script = document.createElement('script');
    script.src = SDK_URL;
    script.async = true;
    const timer = window.setTimeout(() => resolve(null), 8000);
    script.onload = () => {
      window.clearTimeout(timer);
      resolve(window.Telegram?.WebApp ?? null);
    };
    script.onerror = () => {
      window.clearTimeout(timer);
      resolve(null);
    };
    document.head.appendChild(script);
  });
  return loading;
}

/** The bot people should open Cachet from (shown outside Telegram). */
export const BOT_USERNAME = process.env['NEXT_PUBLIC_TELEGRAM_BOT_USERNAME'] ?? 'CachetSealBot';

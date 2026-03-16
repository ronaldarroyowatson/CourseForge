export type SupportedLanguage = "en" | "es" | "pt" | "zm" | "fr" | "de";

export type TranslationNamespace = "common" | "onboarding" | "autoMode" | "settings" | "errors";

export interface TranslationContext {
  browserLanguage?: string;
  osLocale?: string;
  userPreference?: string;
}

const SUPPORTED_LANGUAGES: SupportedLanguage[] = ["en", "es", "pt", "zm", "fr", "de"];

const CATALOG: Record<SupportedLanguage, Record<TranslationNamespace, Record<string, string>>> = {
  en: {
    common: {
      appName: "CourseForge",
      loading: "Loading CourseForge",
      settings: "Settings",
      language: "Language",
      save: "Save",
      cancel: "Cancel",
    },
    onboarding: {
      stepCover: "Capture Cover",
      stepTitle: "Capture Title Page",
      stepToc: "Capture Table of Contents",
      stepEditor: "Review TOC",
    },
    autoMode: {
      chromeOsBanner: "ChromeOS mode active: capture and layout are optimized for Chromebook screens.",
      captureWithChrome: "Capture with Chrome tab API",
      captureFallback: "Capture using display media",
    },
    settings: {
      title: "Settings",
      languageLabel: "Application Language",
      languageHint: "Select your preferred language.",
      accessibilityTitle: "Accessibility",
      colorBlindMode: "Color blind mode",
      dyslexiaMode: "Enable Dyslexia Mode",
      dyscalculiaMode: "Enable Dyscalculia Support",
      highContrastMode: "Enable High Contrast",
      fontScale: "Font scale",
      uiScale: "UI scale",
      saved: "Preferences saved.",
    },
    errors: {
      unknown: "Something went wrong.",
      unsupportedLanguage: "Language is not supported yet. Falling back to English.",
      captureFailed: "Unable to capture the current page.",
    },
  },
  es: { common: {}, onboarding: {}, autoMode: {}, settings: {}, errors: {} },
  pt: { common: {}, onboarding: {}, autoMode: {}, settings: {}, errors: {} },
  zm: {
    common: {
      appName: "CourseForge",
      loading: "CourseForge kiging...",
      settings: "Setting",
      language: "Pau",
      save: "Kikem",
      cancel: "Sut",
    },
    onboarding: {
      stepCover: "Laibu puhna lim la",
      stepTitle: "Minvuat lim la",
      stepToc: "Thubu sunglam la",
      stepEditor: "TOC enpha",
    },
    autoMode: {
      chromeOsBanner: "ChromeOS mode om hi: lahnak leh layout chu Chromebook ading in siam.",
      captureWithChrome: "Chrome tab API tawh la",
      captureFallback: "Display media tawh la",
    },
    settings: {
      title: "Setting",
      languageLabel: "App pau",
      languageHint: "Na duh pau tel in.",
      accessibilityTitle: "Access",
      saved: "Preferencete kikem zo.",
    },
    errors: {
      unknown: "Thil khat khat diklo om hi.",
      unsupportedLanguage: "Hih pau hi tuhun ah support la om nailo. English ah kilet.",
      captureFailed: "Tu page laktheih lo.",
    },
  },
  fr: { common: {}, onboarding: {}, autoMode: {}, settings: {}, errors: {} },
  de: { common: {}, onboarding: {}, autoMode: {}, settings: {}, errors: {} },
};

function normalizeLanguage(input: string | null | undefined): SupportedLanguage {
  const primary = (input ?? "").trim().toLowerCase().split(/[-_]/)[0];
  return SUPPORTED_LANGUAGES.includes(primary as SupportedLanguage) ? (primary as SupportedLanguage) : "en";
}

export function detectLanguage(context: TranslationContext): SupportedLanguage {
  if (context.userPreference) {
    return normalizeLanguage(context.userPreference);
  }

  if (context.osLocale) {
    const osLanguage = normalizeLanguage(context.osLocale);
    if (osLanguage !== "en" || context.osLocale.toLowerCase().startsWith("en")) {
      return osLanguage;
    }
  }

  if (context.browserLanguage) {
    return normalizeLanguage(context.browserLanguage);
  }

  return "en";
}

export function t(language: SupportedLanguage, namespace: TranslationNamespace, key: string): string {
  const primary = CATALOG[language]?.[namespace]?.[key];
  if (primary) {
    return primary;
  }

  const fallback = CATALOG.en[namespace][key];
  return fallback ?? key;
}

export function getSupportedLanguages(): SupportedLanguage[] {
  return [...SUPPORTED_LANGUAGES];
}

export interface TextTranslationRequest {
  text: string;
  targetLanguage: SupportedLanguage;
}

export interface TextTranslationResult {
  translatedText: string;
  language: SupportedLanguage;
  provider: "none" | "ai";
}

export async function translateTextOptional(request: TextTranslationRequest): Promise<TextTranslationResult> {
  // Foundation hook for future AI translation integration.
  return {
    translatedText: request.text,
    language: request.targetLanguage,
    provider: "none",
  };
}

import { ChevronDown } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

const LANGUAGES = [
  { code: "en", label: "EN" },
  { code: "hu", label: "HU" },
];

export function LanguageMenu(): JSX.Element {
  const { i18n, t } = useTranslation();
  const [open, setOpen] = useState(false);
  const current = i18n.language.startsWith("hu") ? "hu" : "en";

  const choose = (code: string): void => {
    void i18n.changeLanguage(code);
    localStorage.setItem("movora.lang", code);
    setOpen(false);
  };

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((value) => !value)}
        title={t("topbar.language")}
        className="flex items-center gap-1 rounded-lg bg-white/5 px-3 py-2 text-sm text-neutral-300 ring-1 ring-white/10 transition hover:bg-white/10"
      >
        {current.toUpperCase()}
        <ChevronDown className="h-3.5 w-3.5" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-50 mt-2 w-28 rounded-lg bg-[#120e1d] p-1 shadow-xl ring-1 ring-white/10">
            {LANGUAGES.map((language) => (
              <button
                key={language.code}
                onClick={() => choose(language.code)}
                className={`block w-full rounded-md px-3 py-1.5 text-left text-sm transition ${
                  current === language.code
                    ? "bg-white/10 text-white"
                    : "text-neutral-300 hover:bg-white/5"
                }`}
              >
                {language.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

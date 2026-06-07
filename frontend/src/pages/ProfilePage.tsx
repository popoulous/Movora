import { type FormEvent, useState } from "react";
import { useTranslation } from "react-i18next";

import { api } from "../api";
import { useAuth } from "../AuthContext";

// 2-letter subtitle-language preference; the player prefers a track in this language.
const SUBTITLE_LANGUAGES: [string, string][] = [
  ["en", "English"],
  ["hu", "Magyar"],
  ["de", "Deutsch"],
  ["fr", "Français"],
  ["es", "Español"],
  ["it", "Italiano"],
  ["ja", "日本語"],
];

const inputClass =
  "w-full rounded-lg bg-white/[0.06] px-3 py-2 text-sm text-neutral-100 ring-1 ring-white/10 focus:ring-violet-400/40 focus:outline-none";

export function ProfilePage(): JSX.Element {
  const { t } = useTranslation();
  const { user, setUser } = useAuth();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  if (user === null) return <p className="text-sm text-neutral-500">…</p>;

  const setLanguage = (value: string): void => {
    api
      .updatePreferences({ preferred_language: value || null })
      .then(setUser)
      .catch(() => undefined);
  };

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    setError(null);
    setDone(false);
    if (next !== confirm) {
      setError(t("profile.mismatch"));
      return;
    }
    if (next.length < 4) {
      setError(t("profile.tooShort"));
      return;
    }
    api
      .changePassword(current, next)
      .then(() => {
        setDone(true);
        setCurrent("");
        setNext("");
        setConfirm("");
      })
      .catch(() => setError(t("profile.wrongCurrent")));
  };

  return (
    <div className="max-w-2xl space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t("profile.title")}</h1>
        <p className="mt-1 text-sm text-neutral-400">
          {user.username} ·{" "}
          {t(user.role === "admin" ? "settings.roleAdmin" : "settings.roleUser")}
        </p>
      </div>

      <section className="space-y-3">
        <h2 className="text-xs font-semibold tracking-wide text-neutral-500 uppercase">
          {t("profile.preferencesTitle")}
        </h2>
        <div className="flex items-center justify-between gap-4 rounded-xl bg-white/[0.03] p-4 ring-1 ring-white/10">
          <span className="min-w-0">
            <span className="block text-sm font-medium text-white">
              {t("settings.preferredLanguage")}
            </span>
            <span className="mt-0.5 block text-xs leading-relaxed text-neutral-400">
              {t("settings.preferredLanguageDesc")}
            </span>
          </span>
          <select
            value={user.preferred_language ?? ""}
            onChange={(event) => setLanguage(event.target.value)}
            className="shrink-0 rounded-lg bg-white/[0.06] px-3 py-2 text-sm text-neutral-100 ring-1 ring-white/10 focus:ring-violet-400/40 focus:outline-none"
          >
            <option value="" className="bg-[#120e1d]">
              {t("settings.languageAuto")}
            </option>
            {SUBTITLE_LANGUAGES.map(([code, name]) => (
              <option key={code} value={code} className="bg-[#120e1d]">
                {name}
              </option>
            ))}
          </select>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-xs font-semibold tracking-wide text-neutral-500 uppercase">
          {t("profile.passwordTitle")}
        </h2>
        <form
          onSubmit={submit}
          className="space-y-3 rounded-xl bg-white/[0.03] p-4 ring-1 ring-white/10"
        >
          <input
            type="password"
            value={current}
            onChange={(event) => setCurrent(event.target.value)}
            placeholder={t("profile.current")}
            autoComplete="current-password"
            className={inputClass}
          />
          <input
            type="password"
            value={next}
            onChange={(event) => setNext(event.target.value)}
            placeholder={t("profile.new")}
            autoComplete="new-password"
            className={inputClass}
          />
          <input
            type="password"
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
            placeholder={t("profile.confirm")}
            autoComplete="new-password"
            className={inputClass}
          />
          {error !== null && <p className="text-xs text-red-400">{error}</p>}
          {done && <p className="text-xs text-emerald-400">{t("profile.changed")}</p>}
          <button
            type="submit"
            className="rounded-xl bg-gradient-to-r from-[#7A4DFF] to-[#EC4899] px-4 py-2.5 text-sm font-semibold text-white transition hover:brightness-110"
          >
            {t("profile.changePassword")}
          </button>
        </form>
      </section>
    </div>
  );
}

import { type FormEvent, useState } from "react";
import { useTranslation } from "react-i18next";

import { api } from "../api";
import { useAuth } from "../AuthContext";

export function AuthPage(): JSX.Element {
  const { t } = useTranslation();
  const { needsSetup, setUser } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const request = needsSetup ? api.setup(username, password) : api.login(username, password);
    request
      .then(setUser)
      .catch(() => setError(needsSetup ? t("auth.setupError") : t("auth.loginError")))
      .finally(() => setBusy(false));
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center px-4">
      <div
        className="pointer-events-none fixed inset-0 -z-10"
        style={{
          background:
            "radial-gradient(circle at 30% 20%, rgba(122,77,255,.18), transparent 45%)," +
            "radial-gradient(circle at 75% 80%, rgba(236,72,153,.10), transparent 50%)",
        }}
      />
      <form
        onSubmit={submit}
        className="w-full max-w-sm space-y-5 rounded-2xl bg-[#0C0E19]/70 p-7 ring-1 ring-white/10 backdrop-blur"
      >
        <div>
          <div className="flex items-center gap-2.5">
            <img
              src="/movora_logo.png"
              alt=""
              className="h-9 w-9 shrink-0 drop-shadow-[0_0_30px_rgba(122,77,255,0.35)]"
            />
            <h1 className="text-2xl font-bold tracking-tight">Movora</h1>
          </div>
          <p className="mt-1 text-sm text-neutral-400">
            {needsSetup ? t("auth.setupSubtitle") : t("auth.loginSubtitle")}
          </p>
        </div>

        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-neutral-400">{t("auth.username")}</span>
          <input
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            autoFocus
            autoComplete="username"
            className="w-full rounded-lg bg-white/[0.06] px-3 py-2.5 text-sm text-neutral-100 ring-1 ring-white/10 focus:ring-violet-400/40 focus:outline-none"
          />
        </label>

        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-neutral-400">{t("auth.password")}</span>
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete={needsSetup ? "new-password" : "current-password"}
            className="w-full rounded-lg bg-white/[0.06] px-3 py-2.5 text-sm text-neutral-100 ring-1 ring-white/10 focus:ring-violet-400/40 focus:outline-none"
          />
        </label>

        {error !== null && <p className="text-sm text-red-400">{error}</p>}

        <button
          type="submit"
          disabled={busy || username === "" || password === ""}
          className="w-full rounded-xl bg-gradient-to-r from-[#7A4DFF] to-[#EC4899] px-4 py-2.5 text-sm font-semibold text-white transition hover:brightness-110 disabled:opacity-50"
        >
          {needsSetup ? t("auth.createAdmin") : t("auth.signIn")}
        </button>
        <p className="text-center text-xs text-neutral-600">{t("auth.rememberNote")}</p>
      </form>
    </div>
  );
}

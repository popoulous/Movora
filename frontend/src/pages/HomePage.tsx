import { useTranslation } from "react-i18next";

export function HomePage(): JSX.Element {
  const { t } = useTranslation();
  return (
    <div className="mx-auto max-w-2xl py-16 text-center">
      <h1 className="text-3xl font-bold tracking-tight">{t("home.welcome")}</h1>
      <p className="mt-3 text-neutral-400">{t("home.subtitle")}</p>
    </div>
  );
}

import { useTranslation } from "../i18n/context";
import { LOCALES, Locale } from "../i18n";

export default function LanguageSwitcher() {
  const { locale, setLocale } = useTranslation();

  return (
    <select
      value={locale}
      onChange={(e) => setLocale(e.target.value as Locale)}
      aria-label="Language"
      style={{
        background: "transparent",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius)",
        color: "var(--text-secondary)",
        padding: "8px 8px",
        fontSize: 12,
        flexShrink: 0,
      }}
    >
      {LOCALES.map(({ code, label }) => (
        <option key={code} value={code}>
          {label}
        </option>
      ))}
    </select>
  );
}

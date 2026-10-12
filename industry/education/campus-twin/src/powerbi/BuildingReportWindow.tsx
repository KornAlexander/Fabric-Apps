import { FloatingWindow } from '@/components/FloatingWindow';
import { useI18n } from '@/i18n';

/**
 * The Power BI report page for the open building, in a window over the scene.
 *
 * A default export in its own file, because `TwinShell` loads it lazily: nobody who never presses
 * "Bericht" should download a window, and Power BI itself is only requested once this mounts.
 *
 * ⚠️ THE APP CANNOT SEE INTO THIS FRAME, AND MUST NOT PRETEND TO. It is another origin: `onLoad`
 * fires for Power BI's sign-in page and for its error page exactly as it does for the report, so
 * there is no honest "loaded" state to show and none is shown. What the window does instead is
 * say the two things a first-time viewer needs (sign in once, and where to open it directly) in
 * its own footer, where they are true whatever the frame is showing.
 *
 * ⚠️ `key={url}` REPLACES THE FRAME, IT DOES NOT NAVIGATE IT. Changing `src` on a live iframe adds
 * an entry to the browser's history, so after five buildings Back would walk through five reports
 * before leaving the app. A new frame per building also means the previous building is never on
 * screen under the new title while the next one loads.
 *
 * Measured 2026-10-10, nested as Fabric portal > app > Power BI, in Chrome: the first open in a
 * browser profile shows Power BI's own sign-in button, one click completes single sign-on without
 * asking for credentials, and it stays signed in across reloads. See docs/POWER-BI-EMBED.md.
 */
export default function BuildingReportWindow({
  url,
  buildingCode,
  onClose,
}: {
  url: string;
  buildingCode: string;
  onClose: () => void;
}) {
  const { t } = useI18n();
  return (
    <FloatingWindow
      title={t('report.title', { code: buildingCode })}
      onClose={onClose}
      closeLabel={t('report.close')}
      maximiseLabel={t('report.maximise')}
      restoreLabel={t('report.restore')}
      initial={{ width: 760, height: 500 }}
      testId="building-report"
      storageKey="campus.reportWindow"
    >
      <div className="flex h-full flex-col">
        <iframe
          key={url}
          data-testid="building-report-frame"
          title={t('report.frameTitle', { code: buildingCode })}
          src={url}
          allowFullScreen
          className="min-h-0 w-full flex-1 border-0 bg-white"
        />
        {/* `pr-7` keeps the link clear of the window's resize corner, which sits over this row. */}
        <p className="flex shrink-0 flex-wrap items-baseline justify-between gap-x-3 border-t border-stone-700 py-1.5 pl-3 pr-7 text-[0.65rem] leading-relaxed text-stone-400">
          <span>{t('report.hint')}</span>
          <a
            data-testid="building-report-newtab"
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-stone-100"
          >
            {t('report.newTab')}
          </a>
        </p>
      </div>
    </FloatingWindow>
  );
}

import { t } from '../i18n';
import { useLanguage } from '../i18n/useLanguage';

const ext = { target: '_blank', rel: 'noopener noreferrer' } as const;

/**
 * Data attribution and the honest notes on what each layer is and is not.
 *
 * ⚠️ THE LICENSORS' REQUIRED WORDING STAYS VERBATIM IN BOTH LANGUAGES. The Bavarian survey
 * credit and the Copernicus credit are prescribed texts, so the English page repeats them as
 * published rather than translating them; only this app's own explanations are translated.
 */
export function Attribution() {
  const lang = useLanguage();
  return (
    <details id="attribution">
      <summary>{t('attribution.summary')}</summary>
      <div>
        <p>Datenquelle: Bayerische Vermessungsverwaltung – www.geodaten.bayern.de [Daten bearbeitet]</p>
        {lang === 'de' ? <German /> : <English />}
      </div>
    </details>
  );
}

function German() {
  return (
    <>
      <p><a href="https://creativecommons.org/licenses/by/4.0/" {...ext}>CC BY 4.0</a>. Gelände, Luftbild, Gebäudegeometrie und Baumstandorte. Kronenradien sind geschätzt, Baumarten sind nicht erfasst. Der Flughafenbereich enthält bewusst keine Baumdaten.</p>
      <p><strong>Hinweis zum Luftbild:</strong> Die im Luftbild sichtbaren Flugzeuge stammen aus dem Befliegungstag und sind Teil der Fotografie. Sie sind keine Echtzeitdaten. Live-Flugzeuge werden als 3D-Modelle darüber dargestellt.</p>
      <p>produced using Copernicus WorldDEM-30 © DLR e.V. 2010–2014 and © Airbus Defence and Space GmbH 2014–2018 provided under COPERNICUS by the European Union and ESA; all rights reserved</p>
      <p><a href="https://www.openstreetmap.org/copyright" {...ext}>© OpenStreetMap contributors</a> (ODbL). Landbedeckung.</p>
      <p>Flugverkehr: Live-ADS-B von <a href="https://adsb.lol/" {...ext}>adsb.lol</a>, einer ehrenamtlichen Empfängergemeinschaft, als offene Daten unter ODbL. Abdeckung und Verfügbarkeit sind nicht zugesichert; nicht jedes Luftfahrzeug sendet ADS-B. Verkehrsflugzeuge und Regionalturboprops, für die eine veröffentlichte Länge hinterlegt ist, werden als maßstabsgetreues Modell dargestellt. Für alle übrigen Luftfahrzeuge, etwa Hubschrauber und Kleinflugzeuge, liegt in dieser Anwendung keine passende Silhouette vor. Sie werden an ihrer gemessenen Position als <strong>neutrales Positionssymbol</strong> gezeichnet und im Ebenenfenster entsprechend gezählt. Das Symbol ist bewusst kein Flugzeugumriss und sagt nichts über Muster oder Größe aus; die Quelle meldet für viele dieser Luftfahrzeuge durchaus ein Muster. Die angezeigte Höhe ist eine Druckhöhe (1013,25 hPa), keine Höhe über Grund.</p>
      <p>Baustellen und Halteverbote: Landeshauptstadt München, offene Daten über WFS.</p>
      <p>MVG Echtzeit: Münchner Verkehrsgesellschaft, öffentliche Abfahrtsschnittstelle.</p>
      <p><strong>Luftqualität amtlich:</strong> Umweltbundesamt, Air Data, stündliche Werte der Messstationen des bayerischen Messnetzes. Dargestellt werden die aktiven Münchner Stationen. Die Säulen sind Symbole, keine Bauwerke: Höhe und Farbe geben den veröffentlichten Gesamtindex wieder, die gemessenen Konzentrationen stehen im Detailfenster. Das Umweltbundesamt veröffentlicht über diese Schnittstelle <strong>keine Definition der Indexskala</strong> und keine Benennung der Stufen. Die Anwendung zeigt deshalb nur die Zahl und die Messwerte, nennt keinen Maximalwert und verwendet keine Einstufung wie „gut“ oder „mäßig“. Die Farbskala ist eine Darstellung dieser Anwendung, nicht die amtliche Farbgebung. Kennzeichnet die Quelle eine Stunde als unvollständig, wird das im Detailfenster angezeigt; das betrifft unter anderem Stationen, an denen nicht alle Komponenten gemessen werden. Ein Messwert gilt für den Standort der Station und für die angegebene Stunde. Die Zeitangabe „Abruf“ im Ebenenfenster ist der Zeitpunkt der Abfrage, nicht der Messzeitpunkt; der Messzeitraum steht im Detailfenster.</p>
      <p><strong>Luftqualität Bürgermessnetz:</strong> <a href="https://sensor.community/" {...ext}>Sensor.Community</a>, offene Daten unter ODbL. Es handelt sich um ehrenamtlich betriebene, <strong>nicht amtlich kalibrierte</strong> Sensoren. Optische Feinstaubsensoren messen bei hoher Luftfeuchte tendenziell zu hoch; die Werte sind mit den amtlichen Stationen nicht direkt vergleichbar. Die Standorte werden von der Quelle aus Datenschutzgründen gerundet veröffentlicht und sind keine Adressangaben. Sensoren, die als Innenraumsensoren gekennzeichnet sind, werden nicht dargestellt. Die Kugeln sind Symbole: ihre Größe und ihre Höhe über dem Gelände sagen nichts über die Bauform oder den Montageort eines Sensors aus. Die Zeitangabe „Abruf“ ist der Zeitpunkt der Abfrage; der Messzeitpunkt jedes Sensors steht im Detailfenster.</p>
      <p><strong>Koordinationsnotizen und Assistent:</strong> Die Notizen entstehen in dieser Anwendung und werden in einer eigenen Fabric SQL-Datenbank gespeichert. Sie sind <strong>kein amtlicher Datensatz</strong> und verändern die offenen Daten der Landeshauptstadt nicht. Der Assistent nutzt ein Sprachmodell in Azure AI Foundry. Er ist angewiesen, ausschließlich die angebundenen Live-Quellen zu verwenden, und zeigt jedes benutzte Werkzeug an; eine technische Garantie dafür gibt es nicht, und Sprachmodelle können sich irren. Der Assistent kann eine Notiz nur vorbereiten und nicht veröffentlichen; das Veröffentlichen geschieht über eine gesonderte Bestätigung. Die Angabe zur verfassenden Person stammt aus der angemeldeten Fabric-Sitzung, wird vom Browser übermittelt und ist deshalb als <em>gemeldet</em> gekennzeichnet, nicht als geprüft. <strong>Dieser Dienst ist eine Demo-Umgebung und nicht zugriffsgeschützt im Sinne einer Fachanwendung</strong>: Notizen sollten keine vertraulichen Inhalte enthalten. Ein Verweis auf eine Baustelle nutzt die Kennung des veröffentlichten Datensatzes; diese Kennung kann bei einer Neuveröffentlichung der Stadt einer anderen Maßnahme zugeordnet werden, weshalb jede Notiz Ort, Koordinaten und Zeitpunkt zusätzlich selbst speichert. Die offenen Baustellendaten nennen keine ausführende Organisation; Angaben dazu stammen allein aus den Notizen der Beteiligten.</p>
    </>
  );
}

function English() {
  return (
    <>
      <p><a href="https://creativecommons.org/licenses/by/4.0/" {...ext}>CC BY 4.0</a>. Terrain, aerial image, building geometry and tree locations. Crown radii are estimated; tree species are not recorded. The airport area deliberately contains no tree data.</p>
      <p><strong>About the aerial image:</strong> the aircraft visible in the aerial image were there on the survey day and are part of the photograph. They are not live data. Live aircraft are drawn above it as 3D models.</p>
      <p>produced using Copernicus WorldDEM-30 © DLR e.V. 2010–2014 and © Airbus Defence and Space GmbH 2014–2018 provided under COPERNICUS by the European Union and ESA; all rights reserved</p>
      <p><a href="https://www.openstreetmap.org/copyright" {...ext}>© OpenStreetMap contributors</a> (ODbL). Land cover.</p>
      <p>Air traffic: live ADS-B from <a href="https://adsb.lol/" {...ext}>adsb.lol</a>, a volunteer receiver community, as open data under ODbL. Coverage and availability are not guaranteed, and not every aircraft transmits ADS-B. Airliners and regional turboprops with a published length on file are drawn as true-to-scale models. For all other aircraft, such as helicopters and light aircraft, this app has no matching silhouette. They are drawn at their measured position as a <strong>neutral position symbol</strong> and counted as such in the layer panel. The symbol is deliberately not an aircraft outline and says nothing about type or size, even though the source does report a type for many of these aircraft. The altitude shown is pressure altitude (1013.25 hPa), not height above ground.</p>
      <p>Roadworks and no-stopping zones: City of Munich, open data via WFS.</p>
      <p>MVG real time: Münchner Verkehrsgesellschaft, public departures interface.</p>
      <p><strong>Air quality, official:</strong> German Environment Agency (Umweltbundesamt), Air Data, hourly values from the stations of the Bavarian monitoring network. The active Munich stations are shown. The columns are symbols, not structures: height and colour show the published overall index, and the measured concentrations are in the detail panel. Through this interface the agency publishes <strong>no definition of the index scale</strong> and no names for its classes. The app therefore shows only the number and the readings, states no maximum and uses no rating such as "good" or "moderate". The colour scale is this app's presentation, not the official colours. If the source marks an hour as incomplete, the detail panel says so; this affects, among others, stations where not every component is measured. A reading applies to the station's location and to the stated hour. The "fetched" time in the layer panel is when the request was made, not when the measurement was taken; the measuring period is in the detail panel.</p>
      <p><strong>Air quality, citizen sensors:</strong> <a href="https://sensor.community/" {...ext}>Sensor.Community</a>, open data under ODbL. These are volunteer-run sensors that are <strong>not officially calibrated</strong>. Optical particulate sensors tend to read high in humid air, so the values are not directly comparable with the official stations. The source publishes locations rounded for privacy, so they are not addresses. Sensors marked as indoor sensors are not shown. The spheres are symbols: their size and height above the ground say nothing about a sensor's design or mounting point. The "fetched" time is when the request was made; each sensor's measuring time is in the detail panel.</p>
      <p><strong>Coordination notes and assistant:</strong> the notes are created in this app and stored in its own Fabric SQL database. They are <strong>not an official record</strong> and do not change the city's open data. The assistant uses a language model in Azure AI Foundry. It is instructed to use only the connected live sources and shows every tool it uses; there is no technical guarantee of that, and language models can be wrong. The assistant can only prepare a note, not publish it; publishing takes a separate confirmation. The author shown comes from the signed-in Fabric session and is sent by the browser, so it is marked <em>as reported</em>, not as verified. <strong>This service is a demo environment and is not access-controlled like a line-of-business application</strong>: notes should not contain confidential content. A reference to a roadworks site uses the id of the published record; the city may assign that id to a different site when it republishes, so every note also stores its own place, coordinates and time. The open roadworks data names no contractor; any such information comes only from the participants' notes.</p>
    </>
  );
}

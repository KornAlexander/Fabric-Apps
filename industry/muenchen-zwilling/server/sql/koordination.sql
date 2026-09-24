-- Koordinationsnotizen zum München Zwilling.
--
-- ⚠️ DIESE TABELLEN SIND KEIN AMTLICHER DATENSATZ. Sie gehören dieser Anwendung. Die Baustellen-
-- daten der Landeshauptstadt werden ausschließlich gelesen und niemals verändert. Eine Notiz
-- verweist über `baustelleId` auf eine veröffentlichte Baumaßnahme, ändert diese aber nicht.
--
-- ⚠️ ZWEI TABELLEN, NICHT EINE. Ein Entwurf ist noch keine Notiz. Der Agent darf ausschließlich
-- Entwürfe erzeugen; erst eine Person, die in der Anwendung bestätigt, erzeugt eine Notiz. Wären
-- beide dieselbe Tabelle mit einem Statusfeld, wäre ein vergessener Filter die einzige Hürde
-- zwischen einem Modellvorschlag und einem Eintrag, den andere Organisationen als abgestimmt lesen.

IF OBJECT_ID('dbo.NotizEntwurf', 'U') IS NULL
CREATE TABLE dbo.NotizEntwurf (
    entwurfId     uniqueidentifier NOT NULL PRIMARY KEY,
    baustelleId   nvarchar(128)    NOT NULL,
    ort           nvarchar(256)    NULL,
    easting       float            NULL,
    northing      float            NULL,
    kategorie     nvarchar(32)     NOT NULL,
    text          nvarchar(2000)   NOT NULL,
    zeitraumVon   nvarchar(32)     NULL,
    zeitraumBis   nvarchar(32)     NULL,
    erstelltAm    datetime2(6)     NOT NULL CONSTRAINT DF_NotizEntwurf_erstelltAm DEFAULT SYSUTCDATETIME(),
    laeuftAbAm    datetime2(6)     NOT NULL,
    -- ⚠️ Einmalige Verwendung. Ohne dieses Feld erzeugt ein doppelter Klick oder ein erneut
    -- gesendetes Formular zwei identische Notizen, und niemand kann hinterher sagen, ob das
    -- Absicht war.
    verwendetAm   datetime2(6)     NULL
);

IF OBJECT_ID('dbo.Koordinationsnotiz', 'U') IS NULL
CREATE TABLE dbo.Koordinationsnotiz (
    notizId       uniqueidentifier NOT NULL PRIMARY KEY,
    baustelleId   nvarchar(128)    NOT NULL,
    ort           nvarchar(256)    NULL,
    easting       float            NULL,
    northing      float            NULL,
    kategorie     nvarchar(32)     NOT NULL,
    text          nvarchar(2000)   NOT NULL,
    zeitraumVon   nvarchar(32)     NULL,
    zeitraumBis   nvarchar(32)     NULL,
    -- ⚠️ "GEMELDET", NICHT "GEPRÜFT", UND DER NAME IST ABSICHT. Dieser Wert stammt aus der
    -- Fabric-Sitzung im Browser und wird vom Client geschickt. Er ist ein deutlicher Fortschritt
    -- gegenüber einem frei eingetippten Namen, aber er ist KEIN serverseitig geprüfter Nachweis.
    -- Ein Feld namens `autorOid` würde eine Beweiskraft suggerieren, die es nicht hat.
    autorGemeldet nvarchar(256)    NULL,
    quelleKanal   nvarchar(32)     NOT NULL,   -- 'app' | 'agent-entwurf'
    entwurfId     uniqueidentifier NULL,
    erstelltAm    datetime2(6)     NOT NULL CONSTRAINT DF_Koordinationsnotiz_erstelltAm DEFAULT SYSUTCDATETIME(),
    zurueckgezogenAm datetime2(6)  NULL
);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Koordinationsnotiz_baustelle')
CREATE INDEX IX_Koordinationsnotiz_baustelle
    ON dbo.Koordinationsnotiz (baustelleId, erstelltAm DESC);
